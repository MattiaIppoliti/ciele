import { afterEach, describe, expect, it, vi } from "vitest";
import { probeAssistantAvailability } from "./assistant-availability-probe";
const target = { id: "a/b", organizationId: "org", title: "Support" };
const config = { version: 1, nickname: "Support", collections: [], style: {} };
afterEach(() => vi.useRealTimers());
describe("independent availability probe", () => {
  it("validates the public config without sending credentials or following redirects", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(config));
    expect(
      await probeAssistantAvailability(target, "https://ciele.app", fetcher),
    ).toMatchObject({ status: "up", issue: null, assistantId: "a/b" });
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toContain("https://ciele.app/api/widget/a%2Fb/config?");
    expect(options).toMatchObject({
      redirect: "error",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
  });
  it.each([
    new Response("unavailable", { status: 503 }),
    new Response("<html>sign in</html>"),
    Response.json({ version: 1 }),
  ])("rejects errors and interstitials", async (response) => {
    const result = await probeAssistantAvailability(
      target,
      "http://localhost:3000",
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
    expect(result.status).toBe("down");
    expect(result.issue).toBe(response.ok ? "invalid_config" : "http_error");
  });
  it("records network failures", async () => {
    expect(
      await probeAssistantAvailability(
        target,
        "https://ciele.app",
        vi.fn<typeof fetch>().mockRejectedValue(new Error("network")),
      ),
    ).toMatchObject({ status: "down", issue: "network_error" });
  });
  it("counts slow valid configs as degraded and bounds timeouts", async () => {
    vi.useFakeTimers();
    const slow = probeAssistantAvailability(
      target,
      "https://ciele.app",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return Response.json(config);
      },
    );
    await vi.advanceTimersByTimeAsync(2500);
    expect(await slow).toMatchObject({
      status: "degraded",
      issue: "slow_response",
      latencyMs: 2500,
    });
    const timeout = probeAssistantAvailability(
      target,
      "https://ciele.app",
      async (_url, options) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("abort")),
          ),
        ),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await timeout).toMatchObject({
      status: "down",
      issue: "timeout",
      latencyMs: 5000,
    });
  });
});
