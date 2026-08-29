import { describe, expect, it } from "vitest";
import {
  BARS,
  DONUT_SEGMENTS,
  GLOBAL_VIEWS,
  LINE_VIEWBOX_H,
  buildDonutGradient,
  dotTop,
  donutStops,
  nextView,
  type View,
} from "./preview-model";

describe("nextView", () => {
  it("advances through the global views and wraps around", () => {
    let view: View = { kind: "global", label: GLOBAL_VIEWS[0] };
    const seen = [view.kind === "global" ? view.label : "?"];
    for (let i = 0; i < GLOBAL_VIEWS.length; i++) {
      view = nextView(view);
      seen.push(view.kind === "global" ? view.label : "?");
    }
    // Five steps from the first view return to the first view.
    expect(seen).toEqual([...GLOBAL_VIEWS, GLOBAL_VIEWS[0]]);
  });

  it("wraps from the last global view back to the first", () => {
    const last: View = { kind: "global", label: GLOBAL_VIEWS.at(-1)! };
    expect(nextView(last)).toEqual({ kind: "global", label: GLOBAL_VIEWS[0] });
  });

  it("resumes at the first global view from a setup view", () => {
    const setup: View = { kind: "setup", slug: "general" };
    expect(nextView(setup)).toEqual({ kind: "global", label: GLOBAL_VIEWS[0] });
  });
});

describe("donutStops / buildDonutGradient", () => {
  it("accumulates contiguous ranges that sum to 100%", () => {
    const stops = donutStops(DONUT_SEGMENTS);
    expect(stops[0].from).toBe(0);
    // Each stop starts where the previous ended.
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i].from).toBe(stops[i - 1].to);
    }
    // The segment values are authored to sum to 100.
    expect(stops.at(-1)!.to).toBe(100);
    expect(DONUT_SEGMENTS.reduce((sum, s) => sum + s.value, 0)).toBe(100);
  });

  it("renders a conic-gradient with one stop per segment", () => {
    // color-mix() colors contain their own commas, so count stops via the
    // model rather than by splitting the string.
    expect(donutStops(DONUT_SEGMENTS)).toHaveLength(DONUT_SEGMENTS.length);
    const gradient = buildDonutGradient(DONUT_SEGMENTS);
    expect(gradient.startsWith("conic-gradient(")).toBe(true);
    expect(gradient).toContain("0% 34%");
    expect(gradient).toContain("93% 100%");
  });
});

describe("dotTop", () => {
  it("maps a viewBox y to a percentage of the chart height", () => {
    expect(dotTop(0)).toBe("0%");
    expect(dotTop(LINE_VIEWBOX_H)).toBe("100%");
    expect(dotTop(24)).toBe("20%");
    expect(dotTop(60)).toBe("50%");
  });
});

describe("mock data shape", () => {
  it("has twelve daily bars", () => {
    expect(BARS).toHaveLength(12);
  });
});
