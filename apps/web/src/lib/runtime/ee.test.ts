import { afterEach, describe, expect, it } from "vitest";
import {
  getEnterpriseCapabilities,
  registerEnterpriseCapabilities,
  resetEnterpriseCapabilities,
} from "./ee";

/**
 * The edition-gating seam (#435). The registry is the single choke point where
 * the open-source and enterprise editions diverge: OSS ships no-op defaults so
 * the mirrored tree is a complete free product; the enterprise edition
 * registers real implementations at startup. These tests pin the two
 * behaviours the whole open-core boundary rests on — defaults are inert, and a
 * registered override wins at the registry boundary.
 */

afterEach(() => resetEnterpriseCapabilities());

describe("enterprise capability registry", () => {
  it("OSS defaults are no-ops: metering allows, billing reports no subscription", async () => {
    const caps = getEnterpriseCapabilities();
    expect(
      await caps.metering.checkUsage({
        organizationId: "o1",
        connectionKind: "platform",
      })
    ).toEqual({ outcome: "allow" });
    expect(await caps.billing.getSubscription("o1")).toBeNull();
  });

  it("registering an override replaces that capability at the registry boundary", async () => {
    registerEnterpriseCapabilities({
      metering: {
        async checkUsage() {
          return { outcome: "block", message: "cap reached" };
        },
      },
    });
    const caps = getEnterpriseCapabilities();
    expect(
      await caps.metering.checkUsage({
        organizationId: "o1",
        connectionKind: "platform",
      })
    ).toEqual({ outcome: "block", message: "cap reached" });
  });

  it("a partial registration leaves untouched capabilities on their OSS default", async () => {
    registerEnterpriseCapabilities({
      metering: {
        async checkUsage() {
          return { outcome: "warn", usedFraction: 0.9 };
        },
      },
    });
    // billing was not overridden — still the no-op default
    expect(await getEnterpriseCapabilities().billing.getSubscription("o1")).toBeNull();
  });

  it("reset restores the OSS defaults", async () => {
    registerEnterpriseCapabilities({
      billing: {
        async getSubscription() {
          return { plan: "pro", status: "active", checkoutUrl: null };
        },
      },
    });
    resetEnterpriseCapabilities();
    expect(
      await getEnterpriseCapabilities().billing.getSubscription("o1")
    ).toBeNull();
  });
});
