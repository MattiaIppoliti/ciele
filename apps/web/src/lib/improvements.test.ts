import { describe, expect, it } from "vitest";
import { keepsLinkNavigation } from "./improvements";

const plain = {
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  button: 0,
};

describe("keepsLinkNavigation", () => {
  it("lets a plain left click open the drawer", () => {
    expect(keepsLinkNavigation(plain)).toBe(false);
  });

  it("keeps the navigation for middle click and every modifier", () => {
    expect(keepsLinkNavigation({ ...plain, button: 1 })).toBe(true);
    expect(keepsLinkNavigation({ ...plain, metaKey: true })).toBe(true);
    expect(keepsLinkNavigation({ ...plain, ctrlKey: true })).toBe(true);
    expect(keepsLinkNavigation({ ...plain, shiftKey: true })).toBe(true);
    expect(keepsLinkNavigation({ ...plain, altKey: true })).toBe(true);
  });
});
