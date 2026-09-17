import { describe, expect, it } from "vitest";
import {
  RIGHT_RAIL_TRANSITION_VAR,
  RIGHT_RAIL_WIDTH_VAR,
  resolveRightRail,
  rightRailVars,
} from "./right-rail";

describe("rightRailVars", () => {
  it("publishes a docked panel's width in pixels", () => {
    expect(rightRailVars({ width: 400, animated: true })).toEqual({
      [RIGHT_RAIL_WIDTH_VAR]: "400px",
      [RIGHT_RAIL_TRANSITION_VAR]: "right 200ms ease-out",
    });
  });

  it("rounds the fractional widths a resize drag produces", () => {
    expect(rightRailVars({ width: 412.6, animated: false })[
      RIGHT_RAIL_WIDTH_VAR
    ]).toBe("413px");
  });

  it("drops the transition mid-drag so nothing lags behind the pointer", () => {
    expect(
      rightRailVars({ width: 412, animated: false })[
        RIGHT_RAIL_TRANSITION_VAR
      ],
    ).toBe("none");
  });

  // Every var goes back to the stylesheet default rather than to a literal
  // zero: a page with no rail should read exactly like one that never had one.
  it("hands both vars back to the stylesheet with no rail", () => {
    expect(rightRailVars(null)).toEqual({
      [RIGHT_RAIL_WIDTH_VAR]: null,
      [RIGHT_RAIL_TRANSITION_VAR]: null,
    });
  });

  it("treats a zero or negative width as no rail", () => {
    expect(rightRailVars({ width: 0, animated: true })).toEqual(
      rightRailVars(null),
    );
    expect(rightRailVars({ width: -12, animated: true })).toEqual(
      rightRailVars(null),
    );
  });
});

/**
 * The rail holds one panel, but more than one `RailPanel` can be *mounted* at
 * once: the Assistant editor mounts the live Preview's launcher and, on the
 * Flow canvas, the Flows Agent, and opening either collapses the other. A
 * collapsed panel publishes `null`, which removed the vars outright — and
 * because the Preview's launcher is a later sibling than the canvas, its effect
 * ran last and wiped the width the agent panel had just published. The
 * notification stack then sat on top of the open panel's composer, which is the
 * one thing this mechanism exists to prevent.
 */
describe("resolveRightRail", () => {
  const wide = { width: 400, animated: true };
  const narrow = { width: 320, animated: false };

  it("is the occupant when one panel holds the rail", () => {
    expect(resolveRightRail([["preview", wide]])).toEqual(wide);
  });

  it("ignores a collapsed neighbour, whichever order they publish in", () => {
    expect(resolveRightRail([["agent", wide], ["preview", null]])).toEqual(wide);
    expect(resolveRightRail([["preview", null], ["agent", wide]])).toEqual(wide);
  });

  it("is nothing once every publisher is collapsed or gone", () => {
    expect(resolveRightRail([["preview", null], ["agent", null]])).toBeNull();
    expect(resolveRightRail([])).toBeNull();
  });

  it("takes the last publisher when two somehow hold the rail at once", () => {
    // Not reachable today (opening one collapses the other) and deliberately
    // deterministic rather than clever, so the vars cannot oscillate.
    expect(resolveRightRail([["preview", wide], ["agent", narrow]])).toEqual(narrow);
  });
});
