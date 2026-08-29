import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";

vi.mock("@/lib/local-inference-relay", () => ({
  listActiveRelayProviders: vi.fn(),
  createRelayCliRunner: vi.fn(() => ({ tag: "relay-runner" })),
}));
vi.mock("@agent-hub/agent/local-providers", () => ({
  // The direct same-process path is a local-development capability; these
  // tests exercise the hosted one, so it reports itself off.
  isLocalSubscriptionDirectEnabled: () => false,
  isLoopbackHost: () => false,
  listLocalSubscriptionStatuses: vi.fn(),
  connectedLocalSubscriptionProviders: vi.fn(() => []),
  verifiedLocalSubscriptionProviders: vi.fn(async () => []),
  createLocalCliRunner: vi.fn(),
}));

import { listActiveRelayProviders } from "@/lib/local-inference-relay";
import { resolvePersonalSubscription } from "./personal-subscription";

/**
 * Who a personal subscription may pay for (#769, ADR-0007 as amended).
 *
 * The runtime's half of the rule (which surfaces qualify) is pinned in
 * `models.test.ts`. This is the other half, and the one with money attached:
 * the answer must depend on **who is asking**, never on which Teammate or
 * Assistant they opened. A colleague chatting with someone else's Teammate must
 * come back with nothing and fall through to the Organization's connections.
 */

const relay = vi.mocked(listActiveRelayProviders);

/** Devices belong to a Member, so the fake relay answers per user id. */
const pairedBy = (owner: string) =>
  relay.mockImplementation(async ({ userId }) =>
    userId === owner ? ["anthropic"] : []
  );

function fakeDb(allowed: boolean): Db {
  return {
    getPersonalAiSubscriptionsAllowed: async () => allowed,
  } as unknown as Db;
}

const resolve = (userId: string, allowed = true) =>
  resolvePersonalSubscription({
    db: fakeDb(allowed),
    organizationId: "org-1",
    userId,
    host: "app.ciele.app",
    origin: "https://app.ciele.app",
  });

beforeEach(() => {
  relay.mockReset();
});

describe("resolvePersonalSubscription", () => {
  it("answers with the asking Member's own paired providers", async () => {
    pairedBy("member-owner");
    const own = await resolve("member-owner");
    expect(own.providers).toEqual(["anthropic"]);
    expect(own.runner).toBeDefined();
  });

  it("gives a colleague nothing, whoever's Teammate they are chatting with", async () => {
    pairedBy("member-owner");
    const colleague = await resolve("member-colleague");
    // No providers and no runner: the turn falls through to the Organization's
    // connections. This is the line that stops one Member's subscription from
    // paying for another Member's turn.
    expect(colleague.providers).toEqual([]);
    expect(colleague.runner).toBeUndefined();
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "member-colleague" })
    );
  });

  it("asks nobody when the Organization has not opted in", async () => {
    pairedBy("member-owner");
    const off = await resolve("member-owner", false);
    expect(off.providers).toEqual([]);
    // The org toggle short-circuits before the relay is consulted at all.
    expect(relay).not.toHaveBeenCalled();
  });

  it("falls back to Organization connections when the relay is unreachable", async () => {
    relay.mockRejectedValue(new Error("relay down"));
    const resolved = await resolve("member-owner");
    // A connector outage is not the Member's problem to see: the turn still
    // runs, on the Organization's own credentials.
    expect(resolved.providers).toEqual([]);
    expect(resolved.runner).toBeUndefined();
  });
});
