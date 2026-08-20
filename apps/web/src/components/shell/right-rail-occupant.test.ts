import { describe, expect, it } from "vitest";
import {
  INITIAL_RIGHT_RAIL,
  parseSnippetTab,
  rightRailReducer,
  type RightRailState,
} from "./right-rail-occupant";

/** One rail, two tenants (#754), the exclusivity rule and the persisted tab. */

const held = (occupant: RightRailState["occupant"]): RightRailState => ({
  ...INITIAL_RIGHT_RAIL,
  occupant,
});

describe("the right rail holds one occupant", () => {
  it("starts empty on the CLI tab", () => {
    expect(INITIAL_RIGHT_RAIL).toEqual({ occupant: null, tab: "cli" });
  });

  it("evicts the Preview when the Developer Panel opens", () => {
    const next = rightRailReducer(held("preview"), {
      type: "open",
      occupant: "developer",
    });
    expect(next.occupant).toBe("developer");
  });

  it("evicts the Developer Panel when the Preview opens", () => {
    const next = rightRailReducer(held("developer"), {
      type: "open",
      occupant: "preview",
    });
    expect(next.occupant).toBe("preview");
  });

  it("never lets both hold it", () => {
    let state = INITIAL_RIGHT_RAIL;
    for (const occupant of ["preview", "developer", "preview"] as const) {
      state = rightRailReducer(state, { type: "open", occupant });
      expect(state.occupant).toBe(occupant);
    }
  });

  it("lets a restore claim only a free rail", () => {
    // Navigating into an Assistant section mounts the Preview launcher, which
    // restores its stored preference. That must not evict an open panel.
    expect(
      rightRailReducer(held("developer"), { type: "claim", occupant: "preview" })
        .occupant
    ).toBe("developer");
    expect(
      rightRailReducer(INITIAL_RIGHT_RAIL, { type: "claim", occupant: "preview" })
        .occupant
    ).toBe("preview");
  });

  it("ignores a close from whoever does not hold it", () => {
    // The Preview restores its stored preference on mount; if that close could
    // evict the rail's actual occupant it would slam a panel the user just
    // opened.
    const state = held("developer");
    expect(
      rightRailReducer(state, { type: "close", occupant: "preview" })
    ).toBe(state);
  });

  it("closes on a close from the occupant, and toggles both ways", () => {
    expect(
      rightRailReducer(held("developer"), { type: "close", occupant: "developer" })
        .occupant
    ).toBeNull();
    expect(
      rightRailReducer(INITIAL_RIGHT_RAIL, { type: "toggle", occupant: "developer" })
        .occupant
    ).toBe("developer");
    expect(
      rightRailReducer(held("developer"), { type: "toggle", occupant: "developer" })
        .occupant
    ).toBeNull();
  });
});

describe("the selected tab outlives the panel", () => {
  it("survives closing and reopening", () => {
    let state = rightRailReducer(INITIAL_RIGHT_RAIL, {
      type: "open",
      occupant: "developer",
    });
    state = rightRailReducer(state, { type: "tab", tab: "mcp" });
    state = rightRailReducer(state, { type: "close", occupant: "developer" });
    state = rightRailReducer(state, { type: "open", occupant: "developer" });
    expect(state.tab).toBe("mcp");
  });

  it("survives the Preview taking the rail in between", () => {
    let state = rightRailReducer(INITIAL_RIGHT_RAIL, { type: "tab", tab: "curl" });
    state = rightRailReducer(state, { type: "open", occupant: "preview" });
    expect(state.tab).toBe("curl");
  });

  it("returns the same object when nothing changes", () => {
    const state = rightRailReducer(INITIAL_RIGHT_RAIL, { type: "tab", tab: "cli" });
    expect(state).toBe(INITIAL_RIGHT_RAIL);
  });
});

describe("restoring a stored tab", () => {
  it("accepts the tabs this build renders", () => {
    expect(parseSnippetTab("mcp")).toBe("mcp");
    expect(parseSnippetTab("curl")).toBe("curl");
  });

  it("rejects anything else rather than trusting storage", () => {
    expect(parseSnippetTab("python")).toBeNull();
    expect(parseSnippetTab(null)).toBeNull();
    expect(parseSnippetTab("")).toBeNull();
  });
});
