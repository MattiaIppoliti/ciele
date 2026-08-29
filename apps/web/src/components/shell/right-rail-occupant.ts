import { SNIPPET_TABS, type SnippetTab } from "@/lib/developer-panel/types";

/**
 * The workspace's right rail: who is *in* it (#754).
 *
 * There is **one** rail and two things that want it: the Assistant editor's live
 * Preview and the Developer Panel. Modelling that as a single occupant rather
 * than two booleans is what makes them mutually exclusive by construction, two
 * independent flags can both be true, and on an editor already squeezed between
 * a sidebar and a form, both being true leaves the form ~400px.
 *
 * Kept in plain TS because vitest ignores `.tsx`: the exclusivity rule and the
 * tab's survival across navigation are the panel's only stateful behaviour, and
 * they are tested here rather than through the components that consume them.
 *
 * Its sibling `right-rail.ts` answers the other question about the same rail,
 * how *wide* it currently is, published as CSS variables so the viewport-fixed
 * notification stack can move aside. Occupancy is state the shell reduces;
 * width is geometry the browser resolves at paint. Different lifetimes, so
 * different modules.
 */

export type RightRailOccupant = "preview" | "developer";

export interface RightRailState {
  occupant: RightRailOccupant | null;
  /**
   * Which snippet surface the Developer Panel is showing. Outlives both the
   * panel closing and a navigation, so someone working in the CLI keeps the CLI
   * tab as they move from Flows to Knowledge.
   */
  tab: SnippetTab;
}

export type RightRailAction =
  | { type: "open"; occupant: RightRailOccupant }
  /** Take the rail only if it is free, how a stored preference is restored. */
  | { type: "claim"; occupant: RightRailOccupant }
  | { type: "close"; occupant: RightRailOccupant }
  | { type: "toggle"; occupant: RightRailOccupant }
  | { type: "tab"; tab: SnippetTab };

export const INITIAL_RIGHT_RAIL: RightRailState = { occupant: null, tab: "cli" };

export function rightRailReducer(
  state: RightRailState,
  action: RightRailAction
): RightRailState {
  switch (action.type) {
    case "open":
      return state.occupant === action.occupant
        ? state
        : { ...state, occupant: action.occupant };
    case "claim":
      // The Preview restores its stored preference when its launcher mounts, and
      // that happens on every navigation into an Assistant section. An open there
      // would evict a Developer Panel the user had opened on the page before,
      // against the panel outliving navigation.
      return state.occupant ? state : { ...state, occupant: action.occupant };
    case "close":
      // Closing something that does not hold the rail must not evict whatever
      // does, otherwise the Preview's mount-time restore could close a panel
      // the user had just opened.
      return state.occupant === action.occupant ? { ...state, occupant: null } : state;
    case "toggle":
      return {
        ...state,
        occupant: state.occupant === action.occupant ? null : action.occupant,
      };
    case "tab":
      return state.tab === action.tab ? state : { ...state, tab: action.tab };
  }
}

/** Whether a stored value is still a tab this build renders. */
export function parseSnippetTab(value: string | null): SnippetTab | null {
  return SNIPPET_TABS.find((tab) => tab === value) ?? null;
}
