import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidRelayPairingCodeError } from "./local-relay-pairing-code";

const mocks = vi.hoisted(() => ({
  getRelayDb: vi.fn(),
}));

vi.mock("./relay-db", () => ({
  getRelayDb: mocks.getRelayDb,
  isRelayDbConfigured: vi.fn(() => true),
}));

import { exchangeRelayPairing } from "./local-inference-relay";

describe("relay pairing storage boundary", () => {
  const previousSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    mocks.getRelayDb.mockReset();
  });

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousSecret;
    }
  });

  it("rejects unsigned public codes before opening a database connection", async () => {
    await expect(
      exchangeRelayPairing({
        code: "a".repeat(43),
        origin: "https://ciele.example.com",
      })
    ).rejects.toBeInstanceOf(InvalidRelayPairingCodeError);

    expect(mocks.getRelayDb).not.toHaveBeenCalled();
  });
});
