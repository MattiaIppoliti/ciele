"use client";

import {
  createContext,
  Suspense,
  use,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFeedback } from "@agent-hub/ui/feedback";
import { CommandMenu } from "@/components/shell/command-menu";
import {
  assistantIdFromPath,
  navItem,
  panelDomainsForPath,
  type AssistantSummary,
} from "@/components/shell/nav";
import {
  INITIAL_RIGHT_RAIL,
  parseSnippetTab,
  rightRailReducer,
  type RightRailOccupant,
} from "@/components/shell/right-rail-occupant";
import { DEFAULT_WIDTH as SIDEBAR_DEFAULT_WIDTH } from "@/components/shell/sidebar-drag";
import type { SnippetTab } from "@/lib/developer-panel/types";
import { chatSession } from "@/lib/chat-session";
import { TopBarSlotsProvider } from "@/components/shell/top-bar-slots";
import { shellHotkey } from "@/components/shell/shell-hotkeys";
import { isTypingTarget } from "@/lib/typing-target";

interface ShellContextValue {
  /** Streamed from the server — resolve via {@link useShellAssistants}. */
  assistants: Promise<AssistantSummary[]>;
  openFind: () => void;
  /** Whether the sidebar is docked (visible in the layout flow). Only consulted
   * from `md` up, below it the sidebar is never in the flow at all. */
  sidebarDocked: boolean;
  setSidebarDocked: (docked: boolean) => void;
  /**
   * The docked sidebar's width. Held here rather than in the sidebar because
   * the top bar reads it too: on the icon rail, Find and the widen control
   * move into the bar, and the bar's button widens the rail back out.
   */
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  /** Whether the off-canvas nav drawer is open. Phones and portrait tablets
   * have no room for a permanent sidebar, so navigation lives here instead. */
  navDrawerOpen: boolean;
  setNavDrawerOpen: (open: boolean) => void;
  /**
   * Which panel holds the single right rail: Preview, Developer panel,
   * Flows Agent or Teammate workspace. One value keeps them exclusive.
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
  /**
   * Where the Chat surface draws its roster and history inside the sidebar,
   * or null when no sidebar is showing it. The sidebar owns the element and
   * the Teammates layout portals into it, so the rail keeps the layout's own
   * context (the leave guard, the streamed data) while living in the shell.
   */
  chatSidebarSlot: ChatSidebarSlot | null;
  registerChatSidebarSlot: (slot: ChatSidebarSlot) => () => void;
}

/** One mounted sidebar offering room for the Chat surface. */
export interface ChatSidebarSlot {
  element: HTMLElement;
  /** Drawn as the icon rail, so only faces fit. */
  collapsed: boolean;
}

const ShellContext = createContext<ShellContextValue | null>(null);

const SNIPPET_TAB_KEY = "developer-panel-tab";

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used within ShellProvider");
  return value;
}

/**
 * The org's assistants, suspending until the server has streamed them. Call
 * from inside a Suspense boundary (the sidebar and top-bar loaders provide
 * one) — the shell itself never blocks on this list.
 */
export function useShellAssistants(): AssistantSummary[] {
  return use(useShell().assistants);
}

/**
 * Client shell state shared by the sidebar, top bar and Find menu: the org's
 * assistants (for scope switching), the command palette (F / Cmd+K), and the
 * workspace's single right rail, which the live Preview and the Developer Panel
 * (D) take turns holding.
 */
export function ShellProvider({
  assistants,
  findScope,
  children,
}: {
  assistants: Promise<AssistantSummary[]>;
  /** Organization, Member and Role, as one string: the Find store's identity. */
  findScope: Promise<string>;
  children: React.ReactNode;
}) {
  const [findOpen, setFindOpen] = useState(false);
  const [sidebarDocked, setSidebarDocked] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [rail, dispatchRail] = useReducer(rightRailReducer, INITIAL_RIGHT_RAIL);
  // A stack, because the docked sidebar, the hover peek and the phone drawer
  // can be mounted at once: the most recent one is the one on screen, and
  // closing it hands the content back to the one beneath.
  const [chatSlots, setChatSlots] = useState<ChatSidebarSlot[]>([]);
  const registerChatSidebarSlot = useCallback((slot: ChatSidebarSlot) => {
    setChatSlots((slots) => [...slots, slot]);
    return () => setChatSlots((slots) => slots.filter((entry) => entry !== slot));
  }, []);
  const chatSidebarSlot = chatSlots.at(-1) ?? null;
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

  // The right rail is a layer like any other: an occupant arriving plays
  // `open`, the rail emptying plays `close`; swapping occupants is neither.
  // Derived from the reducer's state rather than from each dispatcher, because
  // `toggle` and `claim` only know the outcome after the reducer has run.
  const { play } = useFeedback();
  const previousOccupant = useRef(rail.occupant);
  useEffect(() => {
    const before = previousOccupant.current;
    previousOccupant.current = rail.occupant;
    if (before === null && rail.occupant !== null) play("open");
    else if (before !== null && rail.occupant === null) play("close");
  }, [rail.occupant, play]);

  const router = useRouter();

  // `D` is only meaningful where the page has a programmatic surface at all.
  const pageHasApiDomains = panelDomainsForPath(pathname).length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = shellHotkey(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          typing: isTypingTarget(event.target),
        },
        { pageHasApiDomains }
      );
      if (!command) return;
      // Also keeps the browser's own answer (Cmd+O's "open file") away.
      event.preventDefault();
      if (command === "find") setFindOpen(true);
      else if (command === "developerPanel") dispatchRail({ type: "toggle", occupant: "developer" });
      else {
        router.push(navItem("teammates").href);
        chatSession.requestNewChat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pageHasApiDomains, router]);

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
      sidebarWidth,
      setSidebarWidth,
      navDrawerOpen,
      setNavDrawerOpen,
      rightRail: rail.occupant,
      openRightRail,
      claimRightRail,
      closeRightRail,
      toggleRightRail,
      snippetTab: rail.tab,
      setSnippetTab,
      snippetVariables,
      setSnippetVariables,
      chatSidebarSlot,
      registerChatSidebarSlot,
    }),
    [
      assistants,
      sidebarDocked,
      sidebarWidth,
      navDrawerOpen,
      setNavDrawerOpen,
      rail.occupant,
      rail.tab,
      openRightRail,
      claimRightRail,
      closeRightRail,
      toggleRightRail,
      setSnippetTab,
      snippetVariables,
      setSnippetVariables,
      chatSidebarSlot,
      registerChatSidebarSlot,
    ]
  );

  return (
    <ShellContext.Provider value={value}>
      {/* What pages write into the top bar has its own provider, so a page
          registering its actions re-renders the bar and nothing else. */}
      <TopBarSlotsProvider>{children}</TopBarSlotsProvider>
      {/* Resolving the streamed list suspends; a boundary here keeps that
          from bubbling above the provider (the dialog is hidden anyway). */}
      <Suspense fallback={null}>
        <ShellCommandMenu open={findOpen} onOpenChange={setFindOpen} scope={findScope} />
      </Suspense>
    </ShellContext.Provider>
  );
}

function ShellCommandMenu({
  open,
  onOpenChange,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: Promise<string>;
}) {
  const assistants = useShellAssistants();
  return (
    <CommandMenu
      open={open}
      onOpenChange={onOpenChange}
      assistants={assistants}
      scope={use(scope)}
    />
  );
}
