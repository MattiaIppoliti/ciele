"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { CommandMenu } from "@/components/shell/command-menu";
import {
  assistantIdFromPath,
  panelDomainsForPath,
  type AssistantSummary,
} from "@/components/shell/nav";
import {
  INITIAL_RIGHT_RAIL,
  parseSnippetTab,
  rightRailReducer,
  type RightRailOccupant,
} from "@/components/shell/right-rail-occupant";
import type { SnippetTab } from "@/lib/developer-panel/types";

interface ShellContextValue {
  assistants: AssistantSummary[];
  openFind: () => void;
  /** Whether the sidebar is docked (visible in the layout flow). Only consulted
   * from `lg` up, below it the sidebar is never in the flow at all. */
  sidebarDocked: boolean;
  setSidebarDocked: (docked: boolean) => void;
  /** Whether the off-canvas nav drawer is open. Phones and portrait tablets
   * have no room for a permanent sidebar, so navigation lives here instead. */
  navDrawerOpen: boolean;
  setNavDrawerOpen: (open: boolean) => void;
  /** Extra actions a scoped page (e.g. an assistant) renders into the top bar. */
  topBarActions: React.ReactNode | null;
  setTopBarActions: (node: React.ReactNode | null) => void;
  /**
   * Which of the two tenants holds the workspace's single right rail, the
   * Assistant editor's live Preview, or the Developer Panel. One value rather
   * than two booleans, so they cannot both be open (#754).
   */
  rightRail: RightRailOccupant | null;
  openRightRail: (occupant: RightRailOccupant) => void;
  /** Take the rail only if free, for restoring a stored preference on mount. */
  claimRightRail: (occupant: RightRailOccupant) => void;
  closeRightRail: (occupant: RightRailOccupant) => void;
  toggleRightRail: (occupant: RightRailOccupant) => void;
  /** The Developer Panel's surface, kept across navigation and reloads. */
  snippetTab: SnippetTab;
  setSnippetTab: (tab: SnippetTab) => void;
  /**
   * Ids the Developer Panel substitutes into its snippets. The Assistant id
   * comes from the route for free; a page whose ids live elsewhere (a query
   * parameter, say) registers them here.
   */
  snippetVariables: Record<string, string>;
  setSnippetVariables: (variables: Record<string, string>) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

const SNIPPET_TAB_KEY = "developer-panel-tab";

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used within ShellProvider");
  return value;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/**
 * Client shell state shared by the sidebar, top bar and Find menu: the org's
 * assistants (for scope switching), the command palette (F / Cmd+K), and the
 * workspace's single right rail, which the live Preview and the Developer Panel
 * (D) take turns holding.
 */
export function ShellProvider({
  assistants,
  children,
}: {
  assistants: AssistantSummary[];
  children: React.ReactNode;
}) {
  const [findOpen, setFindOpen] = useState(false);
  const [sidebarDocked, setSidebarDocked] = useState(true);
  const [topBarActions, setTopBarActions] = useState<React.ReactNode | null>(null);
  const [rail, dispatchRail] = useReducer(rightRailReducer, INITIAL_RIGHT_RAIL);
  // Keyed by the route it was registered on, so a navigation drops it as a
  // derivation rather than an effect, the same trick `drawerPath` uses below.
  const [registered, setRegistered] = useState<{
    path: string;
    variables: Record<string, string>;
  }>({ path: "", variables: {} });
  const pathname = usePathname();
  // Tapping a row in the drawer navigates, and the drawer covers the very page
  // it just navigated to, so it has to close itself. Storing *which route it
  // was opened on* makes that a derivation rather than an effect: any route
  // change (nav row, Find result, account menu) closes it, with no extra
  // render pass.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const navDrawerOpen = drawerPath === pathname;
  const setNavDrawerOpen = useCallback(
    (open: boolean) => setDrawerPath(open ? pathname : null),
    [pathname]
  );

  const openRightRail = useCallback(
    (occupant: RightRailOccupant) => dispatchRail({ type: "open", occupant }),
    []
  );
  const claimRightRail = useCallback(
    (occupant: RightRailOccupant) => dispatchRail({ type: "claim", occupant }),
    []
  );
  const closeRightRail = useCallback(
    (occupant: RightRailOccupant) => dispatchRail({ type: "close", occupant }),
    []
  );
  const toggleRightRail = useCallback(
    (occupant: RightRailOccupant) => dispatchRail({ type: "toggle", occupant }),
    []
  );
  const setSnippetTab = useCallback((tab: SnippetTab) => {
    dispatchRail({ type: "tab", tab });
    try {
      window.localStorage.setItem(SNIPPET_TAB_KEY, tab);
    } catch {
      /* private mode */
    }
  }, []);

  // Restore the last surface someone worked in. Deferred and validated: a value
  // from an older build is discarded rather than rendering an unknown tab.
  useEffect(() => {
    const stored = parseSnippetTab(window.localStorage.getItem(SNIPPET_TAB_KEY));
    if (stored) dispatchRail({ type: "tab", tab: stored });
  }, []);

  // `D` is only meaningful where the page has a programmatic surface at all.
  const pageHasApiDomains = panelDomainsForPath(pathname).length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setFindOpen(true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "f") {
        event.preventDefault();
        setFindOpen(true);
        return;
      }
      if (key === "d" && pageHasApiDomains) {
        event.preventDefault();
        dispatchRail({ type: "toggle", occupant: "developer" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pageHasApiDomains]);

  const assistantId = assistantIdFromPath(pathname);
  const setSnippetVariables = useCallback(
    (variables: Record<string, string>) => setRegistered({ path: pathname, variables }),
    [pathname]
  );
  const snippetVariables = useMemo(() => {
    const pageVariables = registered.path === pathname ? registered.variables : {};
    return assistantId ? { assistantId, ...pageVariables } : pageVariables;
  }, [assistantId, pathname, registered]);

  const value = useMemo(
    () => ({
      assistants,
      openFind: () => setFindOpen(true),
      sidebarDocked,
      setSidebarDocked,
      navDrawerOpen,
      setNavDrawerOpen,
      topBarActions,
      setTopBarActions,
      rightRail: rail.occupant,
      openRightRail,
      claimRightRail,
      closeRightRail,
      toggleRightRail,
      snippetTab: rail.tab,
      setSnippetTab,
      snippetVariables,
      setSnippetVariables,
    }),
    [
      assistants,
      sidebarDocked,
      navDrawerOpen,
      setNavDrawerOpen,
      topBarActions,
      rail.occupant,
      rail.tab,
      openRightRail,
      claimRightRail,
      closeRightRail,
      toggleRightRail,
      setSnippetTab,
      snippetVariables,
      setSnippetVariables,
    ]
  );

  return (
    <ShellContext.Provider value={value}>
      {children}
      <CommandMenu
        open={findOpen}
        onOpenChange={setFindOpen}
        assistants={assistants}
      />
    </ShellContext.Provider>
  );
}
