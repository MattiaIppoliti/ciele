import { describe, expect, it } from "vitest";
import {
  RIGHT_RAIL_TRANSITION_VAR,
  RIGHT_RAIL_WIDTH_VAR,
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
