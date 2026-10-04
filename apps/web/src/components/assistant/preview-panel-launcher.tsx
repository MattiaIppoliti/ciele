"use client";

import { usePathname } from "next/navigation";
import type { Assistant } from "@agent-hub/core";
import { createElement, useEffect, useReducer, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTouchNavigation } from "@/components/shell/mobile-navigation";
import { useModalFocus } from "@/components/motion/use-modal-focus";
import { RailCollapsed } from "@/components/chat/rail-panel";
import { PreviewPeek } from "./preview-peek";
import { useShell } from "@/components/shell/shell-provider";
import { previewPanelCode } from "./preview-panel-loader";
import { useIdle } from "@/lib/hooks/use-idle";

const COLLAPSED_KEY = "preview-panel-collapsed";

/**
 * A small workspace affordance that loads the interactive preview on demand.
 * Looks exactly like the PreviewPanel's own collapsed rail (the same
 * `RailCollapsed` toggle, strip, hover glimpse and drag handle), so the lazy-load seam is invisible to the user. Dragging
 * the handle mounts the panel already mid-resize.
 *
 * This is the single source of truth for whether the panel starts open on a
 * fresh mount (e.g. navigating to a different assistant), it owns reading
 * the user's last preference from localStorage. PreviewPanel itself must
 * never re-derive that decision after mounting: doing so previously raced
 * this component's own "open" state, silently re-collapsing the panel right
 * after the launcher had just opened it and making the first "Show preview"
 * click on a new assistant appear to do nothing.
 *
 * Open/collapsed is now the workspace's **right rail** (#754), which the preview
 * shares with the Developer Panel: whichever one the user opens takes the rail,
 * and taking it collapses the other. Once mounted the preview *stays* mounted
 * while collapsed, so collapsing it does not throw away the conversation.
 */
export function PreviewPanelLauncher({
  assistant,
  connectorScope,
}: {
  assistant: Assistant;
  connectorScope: string | null;
}) {
  const pathname = usePathname();
  const { rightRail, openRightRail, claimRightRail, closeRightRail } = useShell();
  const touch = useTouchNavigation();
  const modalRef = useRef<HTMLDivElement>(null);
  useModalFocus(touch && rightRail === "preview" && !pathname.endsWith("/preview") && !!previewPanelCode.loaded(), modalRef);
  const [mounted, setMounted] = useState(false);
  const [viaDrag, setViaDrag] = useState(false);
  // Opened by the Member, here or from elsewhere on the page (the Overview's
  // vignette), rather than restored on arrival: only the first unfolds, the
  // restored panel is simply there.
  const [animateEntry, setAnimateEntry] = useState(false);
  // The "Preview" section *is* the preview; docking a second copy of
  // it alongside would show the same chat twice, with two separate
  // conversations.
  const onPreviewRoute = pathname.endsWith("/preview");
  const open = rightRail === "preview";
  // Whether the arrival restore below has run: an open before it is carried
  // over from the page before, one after it was asked for on this page.
  const [arrived, setArrived] = useState(false);

  // Restore the user's choice; with none stored, start collapsed on narrow
  // viewports so the panel doesn't crush the settings form (client-only to
  // keep SSR markup stable; deferred so the effect doesn't set state
  // synchronously on mount).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(COLLAPSED_KEY);
      const wanted = !window.matchMedia("(max-width: 1023px), (hover: none) and (pointer: coarse)").matches && (stored !== null ? stored === "0" : window.innerWidth >= 1280);
      if (wanted) {
        setMounted(true);
        // Claim, not open: this fires on every navigation into an Assistant
        // section, and must not evict a Developer Panel opened on the page
        // before.
        claimRightRail("preview");
      }
      setArrived(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [claimRightRail]);

  // Re-render when the panel's code lands, so a mount waiting on it proceeds.
  const [, codeLanded] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (mounted && !previewPanelCode.loaded()) {
      previewPanelCode.load().then(codeLanded, () => {
        // Stays on the collapsed rail; the next open retries the fetch.
      });
    }
  }, [mounted]);

  // Fetch the panel's code once the page has settled, so the first open does
  // not wait on the network.
  useIdle(previewPanelCode.prefetch, 1500);

  function remember(collapsed: boolean) {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* private mode */
    }
  }

  // Mounting follows from the open: the rail now holds the Preview.
  function openExplicitly() {
    setAnimateEntry(true);
    remember(false);
    openRightRail("preview");
  }

  // Once the rail has held the Preview, it stays mounted while collapsed, like
  // one opened here, so closing it does not throw the conversation away.
  // Set during render (React's "adjust state on a prop change"), not in an
  // effect, so there is no frame where the panel is open but unmounted.
  if (open && !mounted) {
    setMounted(true);
    // The rail was handed over from elsewhere (the Overview's vignette). After
    // arrival that open was asked for, so it unfolds like one made here; before
    // it, a rail still holding the Preview from the page before is a restore,
    // and should simply be there.
    setAnimateEntry(arrived);
  }

  if (onPreviewRoute) return null;

  // Mounted but its code not landed yet (an open faster than the prefetch):
  // the collapsed rail holds the edge until it does, rather than a blank.
  // `createElement`, not JSX: the component is the one module export, the same
  // reference on every render, which the compiler's lint cannot see through a
  // function call and would otherwise flag as a component made in render.
  const previewPanel = previewPanelCode.loaded()?.PreviewPanel ?? null;
  if (touch) {
    if (!mounted || !previewPanel) return null;
    return createPortal(<div ref={modalRef} hidden={!open} role="dialog" aria-modal="true" aria-label="Chatbot preview" tabIndex={-1} className="mobile-chatbot-preview fixed inset-0 z-[80] flex flex-col bg-background outline-none" onKeyDown={event => { if (event.key === "Escape") closeRightRail("preview"); }}>
      <header className="flex shrink-0 items-center justify-between border-b px-4 pt-[env(safe-area-inset-top)]"><h2 className="text-base font-medium">Chatbot preview</h2><button type="button" aria-label="Close chatbot preview" className="flex size-[44px] items-center justify-center rounded-lg hover:bg-muted" onClick={() => closeRightRail("preview")}><X size={20} /></button></header>
      <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{createElement(previewPanel, { assistant, connectorScope, variant: "page" })}</div>
    </div>, document.body);
  }
  if (mounted && previewPanel) {
    return createElement(previewPanel, {
      assistant,
      connectorScope,
      startResizing: viaDrag,
      animateEntry,
      collapsed: !open,
      onCollapsedChange: (collapsed: boolean) => {
        remember(collapsed);
        if (collapsed) closeRightRail("preview");
        else openRightRail("preview");
      },
    });
  }

  return (
    <RailCollapsed
      onIntent={previewPanelCode.prefetch}
      peek={<PreviewPeek assistant={assistant} />}
      label="Show preview"
      resizeLabel="Resize preview panel"
      onOpen={openExplicitly}
      onResizeStart={() => {
        setViaDrag(true);
        openExplicitly();
      }}
    />
  );
}
