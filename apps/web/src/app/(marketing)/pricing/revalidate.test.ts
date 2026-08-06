import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The pricing page is the one marketing page whose output depends on server
 * configuration — `STRIPE_SECRET_KEY` and the `STRIPE_PRICE_*` ids — and the
 * self-host image is built before that configuration exists. A pure static
 * prerender therefore publishes the build's answer ("no prices, talk to sales")
 * for the life of the deployment; `revalidate` is what lets the running server
 * replace it. Asserted against the source rather than by importing the module,
 * which would pull `next` and the enterprise seam into a node-env test.
 *
 * Read as: deleting `revalidate` here is a silent regression, so make it a loud
 * one. Removing it deliberately means deciding what replaces it.
 */
const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8"
);

describe("pricing route segment config", () => {
  it("regenerates on the server instead of freezing the build's prices", () => {
    const match = SOURCE.match(/^export const revalidate = (\d+);$/m);

    expect(match, "pricing/page.tsx must export a numeric `revalidate`").not.toBeNull();
    // A window, not zero (which is force-dynamic by another name and would drop
    // the prerendering) and not so long an operator cannot tell it worked.
    const seconds = Number(match?.[1]);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(3600);
  });

  it("does not opt out of prerendering, which the whole group depends on", () => {
    expect(SOURCE).not.toMatch(/export const dynamic\b/);
  });
});
