"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { CommandMenu } from "@/components/shell/command-menu";
import type { AssistantSummary } from "@/components/shell/nav";

interface ShellContextValue {
  assistants: AssistantSummary[];
  openFind: () => void;
  /** Whether the sidebar is docked (visible in the layout flow). Only consulted
   * from `lg` up — below it the sidebar is never in the flow at all. */
  sidebarDocked: boolean;
  setSidebarDocked: (docked: boolean) => void;
  /** Whether the off-canvas nav drawer is open. Phones and portrait tablets
   * have no room for a permanent sidebar, so navigation lives here instead. */
  navDrawerOpen: boolean;
  setNavDrawerOpen: (open: boolean) => void;
  /** Extra actions a scoped page (e.g. an assistant) renders into the top bar. */
  topBarActions: React.ReactNode | null;
  setTopBarActions: (node: React.ReactNode | null) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

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
 * assistants (for scope switching) and the command palette, opened with
 * F / Cmd+K anywhere in the admin.
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
  const pathname = usePathname();
  // Tapping a row in the drawer navigates, and the drawer covers the very page
  // it just navigated to — so it has to close itself. Storing *which route it
  // was opened on* makes that a derivation rather than an effect: any route
  // change (nav row, Find result, account menu) closes it, with no extra
  // render pass.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const navDrawerOpen = drawerPath === pathname;
  const setNavDrawerOpen = useCallback(
    (open: boolean) => setDrawerPath(open ? pathname : null),
    [pathname]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setFindOpen(true);
        return;
      }
      if (
        event.key.toLowerCase() === "f" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
    }),
    [assistants, sidebarDocked, navDrawerOpen, setNavDrawerOpen, topBarActions]
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
