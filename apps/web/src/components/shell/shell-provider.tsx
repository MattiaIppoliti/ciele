"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { CommandMenu } from "@/components/shell/command-menu";
import type { AssistantSummary } from "@/components/shell/nav";

interface ShellContextValue {
  assistants: AssistantSummary[];
  openFind: () => void;
  /** Whether the sidebar is docked (visible in the layout flow). */
  sidebarDocked: boolean;
  setSidebarDocked: (docked: boolean) => void;
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
      topBarActions,
      setTopBarActions,
    }),
    [assistants, sidebarDocked, topBarActions]
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
