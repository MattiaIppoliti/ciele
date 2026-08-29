import { describe, expect, it } from "vitest";
import {
  SPRING_LAYOUT,
  SPRING_MOUSE,
  SPRING_PANEL,
  SPRING_PRESS,
  SPRING_SWAP,
  SPRING_THROW,
} from "./ease";

/**
 * Damping ratio. 1.0 is critically damped: the fastest a spring reaches its
 * target without overshooting. Below 1 it bounces. Above 1 it is overdamped,
 * which is strictly worse than 1.0, slower to settle and still no bounce.
 */
function dampingRatio({
  stiffness,
  damping,
  mass,
}: {
  stiffness: number;
  damping: number;
  mass: number;
}): number {
  return damping / (2 * Math.sqrt(stiffness * mass));
}

/** Apple's "response": how quickly the value reaches the target, in seconds. */
function response({
  stiffness,
  mass,
}: {
  stiffness: number;
  mass: number;
}): number {
  return 2 * Math.PI * Math.sqrt(mass / stiffness);
}

const ALL = {
  SPRING_PRESS,
  SPRING_SWAP,
  SPRING_PANEL,
  SPRING_LAYOUT,
  SPRING_MOUSE,
  SPRING_THROW,
};

describe("spring tokens", () => {
  it("never ships an overdamped spring", () => {
    // Overdamped buys nothing: it settles slower than critical damping and
    // still never overshoots. SPRING_PANEL sat at 1.38 until it was retuned.
    for (const [name, spring] of Object.entries(ALL)) {
      expect(dampingRatio(spring), name).toBeLessThanOrEqual(1.1);
    }
  });

  it("keeps every spring within a perceptibly snappy response", () => {
    // Apple ships 0.3-0.4s for move/rotate/drawer. Ours run slightly snappier;
    // anything past 0.6s stops reading as a response to the input at all.
    for (const [name, spring] of Object.entries(ALL)) {
      expect(response(spring), name).toBeGreaterThan(0.1);
      expect(response(spring), name).toBeLessThan(0.6);
    }
  });

  it("reserves overshoot for SPRING_THROW", () => {
    // Everything else settles without bouncing, because nothing else follows a
    // gesture that carried momentum.
    expect(dampingRatio(SPRING_THROW)).toBeLessThan(0.9);
    for (const [name, spring] of Object.entries(ALL)) {
      if (name === "SPRING_THROW") continue;
      expect(dampingRatio(spring), name).toBeGreaterThan(0.85);
    }
  });

  it("puts SPRING_PANEL at critical damping", () => {
    expect(dampingRatio(SPRING_PANEL)).toBeGreaterThan(0.95);
    expect(dampingRatio(SPRING_PANEL)).toBeLessThan(1.05);
  });
});
