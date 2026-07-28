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
        resource: "ai",
      })
    ).toEqual({ outcome: "allow" });
    expect(await caps.metering.getUsageLimits("o1")).toBeNull();
    expect(await caps.billing.getSubscription("o1")).toBeNull();
  });

  it("registering an override replaces that capability at the registry boundary", async () => {
    registerEnterpriseCapabilities({
      metering: {
        async checkUsage() {
          return {
            outcome: "block",
            message: "cap reached",
            resource: "ai",
            window: "month",
            resetsAt: "2026-08-01T00:00:00.000Z",
          };
        },
        async getUsageLimits() {
          return null;
        },
      },
    });
    const caps = getEnterpriseCapabilities();
    expect(
      await caps.metering.checkUsage({
        organizationId: "o1",
        connectionKind: "platform",
        resource: "ai",
      })
    ).toMatchObject({ outcome: "block", message: "cap reached", window: "month" });
  });

  it("a partial registration leaves untouched capabilities on their OSS default", async () => {
    registerEnterpriseCapabilities({
      metering: {
        async checkUsage() {
          return {
            outcome: "warn",
            usedFraction: 0.9,
            resource: "ai",
            window: "week",
            resetsAt: "2026-07-08T00:00:00.000Z",
          };
        },
        async getUsageLimits() {
          return null;
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
          return {
            plan: "pro",
            status: "active",
            checkoutUrl: null,
            stripeManaged: true,
          };
        },
        getPlanCatalog() {
          return {
            tiers: [
              {
                slug: "pro",
                priceEur: 199,
                salesLed: false,
                checkout: true,
                volumes: { answers: 1_000, pages: 200, documents: 300 },
              },
            ],
            answerBasis: {
              quotedModel: "Light",
              frontierModel: "Frontier",
              frontierFactor: 100,
            },
          };
        },
        async startUpgradeCheckout() {
          return "https://checkout.example/session";
        },
        async startBillingPortal() {
          return "https://portal.example/session";
        },
        async reconcileCheckout() {
          return true;
        },
      },
    });
    resetEnterpriseCapabilities();
    expect(
      await getEnterpriseCapabilities().billing.getSubscription("o1")
    ).toBeNull();
  });
});
