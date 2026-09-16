import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getDb: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/data", () => ({ getDb: mocks.getDb }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));

import Page from "./page";

function render(provider = "slack", query: Record<string, string> = {}) {
  return Page({ params: Promise.resolve({ provider }), searchParams: Promise.resolve(query) });
}

describe("Application connection handoff", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "connect-test-key");
    vi.stubEnv("SLACK_APPLICATION_CLIENT_ID", "ciele-slack-client");
    vi.stubEnv("SLACK_APPLICATION_CLIENT_SECRET", "ciele-slack-secret");
    vi.stubEnv("GOOGLE_APPLICATION_CLIENT_ID", "ciele-google-client");
    vi.stubEnv("GOOGLE_APPLICATION_CLIENT_SECRET", "ciele-google-secret");
    mocks.getSession.mockReset().mockResolvedValue({
      userId: "member-1", organization: { id: "org-1", name: "Acme" }, role: "owner",
    });
    mocks.getConnection.mockReset().mockResolvedValue(null);
    mocks.getDb.mockReset().mockResolvedValue({ getSafeApplicationConnection: mocks.getConnection });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("shows the provider destination before authorization without exposing client credentials", async () => {
    const html = renderToStaticMarkup(await render());
    expect(html).toContain("Continue connecting");
    expect(html).toContain("slack.com");
    expect(html).toContain("Acme");
    expect(html).not.toContain("ciele-slack-client");
    expect(html).not.toContain("ciele-slack-secret");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each(["SLACK_APPLICATION_CLIENT_ID", "SLACK_APPLICATION_CLIENT_SECRET", "APP_ENCRYPTION_KEY"])(
    "explains deployment setup without a broken authorization link when %s is missing", async (key) => {
      vi.stubEnv(key, "");
      const html = renderToStaticMarkup(await render());
      expect(html).toContain("Slack needs to be enabled");
      expect(html).toContain("View connection setup guide");
      expect(html).not.toContain("Continue connecting");
      expect(html).not.toContain("APPLICATION_CLIENT");
    },
  );

  it("resumes the same connection and return destination after Ciele sign-in", async () => {
    mocks.getSession.mockResolvedValue(null);
    const continuation = "/application-connect/slack?" + new URLSearchParams({
      returnTo: "/assistants/a1/knowledge", connectionId: "connection-1",
    });
    await expect(render("slack", { returnTo: "/assistants/a1/knowledge", connectionId: "connection-1" }))
      .rejects.toThrow(`REDIRECT:/login?${new URLSearchParams({ next: continuation })}`);
  });

  it("does not allow an external return destination", async () => {
    const page = await render("slack", { returnTo: "//evil.example/" });
    expect(page.props.returnTo).toBe("/library/applications");
  });

  it("keeps the provider role boundary on the handoff page", async () => {
    mocks.getSession.mockResolvedValue({
      userId: "member-1", organization: { id: "org-1", name: "Acme" }, role: "editor",
    });
    await expect(render("slack")).rejects.toThrow("NOT_FOUND");
    expect(renderToStaticMarkup(await render("google_drive"))).toContain("Continue connecting");
  });

  it.each([
    { organizationId: "org-2", ownerMemberId: "member-1" },
    { organizationId: "org-1", ownerMemberId: "member-2" },
  ])("refuses another Organization or Member's reconnect target", async (ownership) => {
    mocks.getConnection.mockResolvedValue({
      id: "connection-1", provider: "google_drive", ownerType: "member", ...ownership,
    });
    await expect(render("google_drive", { connectionId: "connection-1" })).rejects.toThrow("NOT_FOUND");
  });

  it("preserves a valid reconnect target", async () => {
    mocks.getConnection.mockResolvedValue({
      id: "connection-1", provider: "google_drive", ownerType: "member",
      organizationId: "org-1", ownerMemberId: "member-1",
    });
    const page = await render("google_drive", { connectionId: "connection-1" });
    expect(page.props.connectionId).toBe("connection-1");
  });

  it("rejects an unknown provider", async () => {
    await expect(render("unknown")).rejects.toThrow("NOT_FOUND");
  });
});
