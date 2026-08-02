"use client";

import dynamic from "next/dynamic";
import type { Assistant } from "@agent-hub/core";
import { ChevronsLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { ResizeHandle } from "@/components/ui/resizable-panel";

const PreviewPanel = dynamic(
  () => import("./preview-panel").then((module) => module.PreviewPanel),
  { ssr: false }
);

const COLLAPSED_KEY = "preview-panel-collapsed";

/**
 * A small workspace affordance that loads the interactive preview on demand.
 * Looks exactly like the PreviewPanel's own collapsed rail (« to show, plus
 * the drag handle), so the lazy-load seam is invisible to the user. Dragging
 * the handle mounts the panel already mid-resize.
 *
 * This is the single source of truth for whether the panel starts open on a
 * fresh mount (e.g. navigating to a different assistant) — it owns reading
 * the user's last preference from localStorage. PreviewPanel itself must
 * never re-derive that decision after mounting: doing so previously raced
 * this component's own "open" state, silently re-collapsing the panel right
 * after the launcher had just opened it and making the first "Show preview"
 * click on a new assistant appear to do nothing.
 */
export function PreviewPanelLauncher({
  assistant,
  connectorScope,
}: {
  assistant: Assistant;
  connectorScope: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [viaDrag, setViaDrag] = useState(false);

  // Restore the user's choice; with none stored, start collapsed on narrow
  // viewports so the panel doesn't crush the settings form (client-only to
  // keep SSR markup stable; deferred so the effect doesn't set state
  // synchronously on mount).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      setOpen(stored !== null ? stored === "0" : window.innerWidth >= 1280);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function openExplicitly() {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, "0");
    } catch {
      /* private mode */
    }
    setOpen(true);
  }

  if (open) {
    return (
      <PreviewPanel
        assistant={assistant}
        connectorScope={connectorScope}
        startResizing={viaDrag}
      />
    );
  }

  return (
    <aside className="bg-background relative hidden w-12 shrink-0 flex-col items-center border-l pt-4 md:flex">
      <ResizeHandle
        resizing={false}
        onPointerDown={() => {
          setViaDrag(true);
          openExplicitly();
        }}
        label="Resize preview panel"
      />
      <Hint label="Show preview" side="left">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Show preview"
          onClick={openExplicitly}
        >
          <ChevronsLeft className="size-4" />
        </Button>
      </Hint>
    </aside>
  );
}
