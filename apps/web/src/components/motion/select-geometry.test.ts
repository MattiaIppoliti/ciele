import { describe, expect, it } from "vitest";
import { optionScrollDelta, selectPopupGeometry } from "./select-geometry";

const viewport = { top: 0, bottom: 800, left: 0, right: 390 };
const trigger = { top: 640, bottom: 684, left: 120, right: 350 };
const content = { height: 600, width: 256 };

describe("inline select geometry", () => {
  it("opens above a trigger near the foot of an iPhone viewport", () => {
    expect(selectPopupGeometry(trigger, viewport, content)).toMatchObject({ side: "top", maxHeight: 320 });
  });
  it("honors a preferred side when it fits", () => {
    const boundary = { ...viewport, bottom: 1200 };
    expect(selectPopupGeometry(trigger, boundary, content).side).toBe("bottom");
  });
  it("flips even an explicit top preference when a short landscape screen has more room below", () => {
    const anchor = { ...trigger, top: 24, bottom: 68 };
    expect(selectPopupGeometry(anchor, { ...viewport, bottom: 320 }, content, "top"))
      .toMatchObject({ side: "bottom", maxHeight: 236 });
  });
  it("limits scrolling options to the Settings scrollport", () => {
    expect(selectPopupGeometry(trigger, { ...viewport, top: 500, bottom: 720 }, content))
      .toMatchObject({ side: "top", maxHeight: 124 });
  });
  it("accounts for the viewport left after the software keyboard opens", () => {
    const anchor = { ...trigger, top: 280, bottom: 324 };
    expect(selectPopupGeometry(anchor, { ...viewport, top: 100, bottom: 380 }, content))
      .toMatchObject({ side: "top", maxHeight: 164 });
  });
  it("shifts a model picker away from the right edge", () => {
    expect(selectPopupGeometry(trigger, viewport, content)).toMatchObject({ leftOffset: 0 });
    const anchor = { ...trigger, left: 240 };
    expect(selectPopupGeometry(anchor, viewport, content).leftOffset).toBe(-114);
  });
  it("caps wide menus in a 320px scrollport and never returns a negative size", () => {
    const geometry = selectPopupGeometry(trigger, { ...viewport, right: 320, bottom: 650, top: 640 }, { ...content, width: 500 });
    expect(geometry.maxWidth).toBe(304);
    expect(geometry.maxHeight).toBe(0);
  });
  it("lets a portalled popover use more height while keeping it inside the viewport", () => {
    expect(selectPopupGeometry(trigger, viewport, content, "top", Infinity).maxHeight).toBe(624);
  });
});

describe("option visibility", () => {
  const list = { top: 100, bottom: 260 };
  it("leaves visible options and the surrounding form still", () => {
    expect(optionScrollDelta({ top: 120, bottom: 164 }, list)).toBe(0);
  });
  it("scrolls just enough to reveal the selected or keyboard-focused option", () => {
    expect(optionScrollDelta({ top: 60, bottom: 104 }, list)).toBe(-40);
    expect(optionScrollDelta({ top: 250, bottom: 294 }, list)).toBe(34);
  });
});
