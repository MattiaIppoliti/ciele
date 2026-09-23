import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSecret, type Role } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { OperationContext, OperationPorts } from "./operation";
import {
  deleteCrawlerConnectionOp,
  getCrawlerConnectionOp,
  setCrawlerConnectionOp,
} from "./crawlers";

const ctx = (ports?: OperationPorts): OperationContext => ({
  organizationId: DEMO_ORG.id,
  userId: DEMO_MEMBER.userId,
  role: "admin" as Role,
  db: getMockDb(),
  ports,
});

const verifiesAs = (accountId: string): OperationPorts => ({
  verifyCrawlerToken: async () => ({ ok: true, accountId }),
});

/**
 * Settings → Crawling. The token is sealed and never read back; the account
 * id comes from the crawler, and a typed one is only a cross-check.
 */
describe("crawler connection operations", () => {
  beforeEach(() => vi.stubEnv("APP_ENCRYPTION_KEY", "test-key"));
  afterEach(async () => {
    vi.unstubAllEnvs();
    await getMockDb().deleteCrawlerConnection(DEMO_ORG.id, "apify");
  });

  it("seals the token, keeps only its hint in the view, and fills the account id", async () => {
    const result = await setCrawlerConnectionOp.run(ctx(verifiesAs("acct-9")), {
      provider: "apify",
      token: "apify_api_abcd1234",
    });

    expect(result.connection).toEqual({
      provider: "apify",
      tokenHint: "…1234",
      accountId: "acct-9",
      updatedAt: expect.any(String),
    });
    const stored = await getMockDb().getCrawlerConnection(DEMO_ORG.id, "apify");
    expect(stored?.encryptedToken).not.toContain("apify_api");
    expect(openSecret(stored!.encryptedToken)).toBe("apify_api_abcd1234");
  });

  it("refuses a token from a different account than the one typed", async () => {
    const result = await setCrawlerConnectionOp.run(ctx(verifiesAs("acct-9")), {
      provider: "apify",
      token: "apify_api_abcd1234",
      accountId: "acct-other",
    });

    expect(result.error).toMatch(/acct-9.*acct-other/);
    expect(
      await getMockDb().getCrawlerConnection(DEMO_ORG.id, "apify")
    ).toBeNull();
  });

  it("stores nothing when the crawler rejects the token", async () => {
    const result = await setCrawlerConnectionOp.run(
      ctx({ verifyCrawlerToken: async () => ({ ok: false, error: "nope" }) }),
      { provider: "apify", token: "bad" }
    );

    expect(result.error).toBe("nope");
    expect(await getCrawlerConnectionOp.run(ctx(), { provider: "apify" })).toBeNull();
  });

  it("disconnects", async () => {
    await setCrawlerConnectionOp.run(ctx(verifiesAs("acct-9")), {
      provider: "apify",
      token: "apify_api_abcd1234",
    });
    await deleteCrawlerConnectionOp.run(ctx(), { provider: "apify" });
    expect(await getCrawlerConnectionOp.run(ctx(), { provider: "apify" })).toBeNull();
  });
});
