import { describe, expect, it } from "vitest";
import { defaultProjectView } from "./project-view-preference";

describe("defaultProjectView", () => {
  it("opens the remembered view, and the List when there is none or it is gone", () => {
    expect(defaultProjectView("board")).toBe("board");
    expect(defaultProjectView(undefined)).toBe("list");
    expect(defaultProjectView("views")).toBe("list");
  });
});
