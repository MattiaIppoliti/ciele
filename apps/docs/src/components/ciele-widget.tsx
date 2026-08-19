'use client';

import { useEffect, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { useResizableWidth } from '@agent-hub/ui/use-resizable-width';

/**
 * "Ask AI" launcher that reuses the published Ciele assistant's own chat panel
 * (embedded as an iframe) rather than a bespoke chat UI. The floating button
 * uses an animated chat icon; opening it slides in a right-side drawer that
 * hosts the assistant. The drawer is drag-resizable from its left edge using
 * the shared `useResizableWidth` hook (same behavior as the app's preview
 * panel), and it forwards the docs site's light/dark theme to the widget.
 *
 * Configurable via env, with production defaults baked in:
 *   NEXT_PUBLIC_CIELE_WIDGET_ORIGIN, origin serving the embeddable chat
 *   NEXT_PUBLIC_CIELE_ASSISTANT_ID, the published assistant id
 */
const WIDGET_ORIGIN =
  process.env.NEXT_PUBLIC_CIELE_WIDGET_ORIGIN || 'https://ciele.app';
const ASSISTANT_ID =
  process.env.NEXT_PUBLIC_CIELE_ASSISTANT_ID || 'IV8Lutea-RJ7';

/** Animated chat bubble, wiggles on hover (see .ciele-ask-ai in global.css). */
function ChatBubbleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="ciele-ask-ai-icon"
      fill="none"
      height={size}
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

/** Track the docs site theme (next-themes toggles `.dark` on <html>). */
function useIsDark() {
  const [dark, setDark] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() =>
      setDark(el.classList.contains('dark')),
    );
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function CieleWidget() {
  const [open, setOpen] = useState(false);
  // The embedded chat can request full screen from its header's ⋯ menu
  // (posts ciele:fullscreen / ciele:restore, same protocol as widget.js).
  const [fullscreen, setFullscreen] = useState(false);
  const dark = useIsDark();
  const { width, resizing, beginResize, containerRef } = useResizableWidth({
    defaultWidth: 400,
    minWidth: 320,
    maxWidth: 900,
    anchor: 'right',
  });

  // Widget messages: close collapses the drawer, fullscreen expands it to
  // the whole viewport until restored.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== new URL(WIDGET_ORIGIN).origin) return;
      if (event.data === 'ciele:close') {
        setOpen(false);
        setFullscreen(false);
      } else if (event.data === 'ciele:fullscreen') {
        setFullscreen(true);
      } else if (event.data === 'ciele:restore') {
        setFullscreen(false);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Reserve right-side space so the docs content reflows instead of hiding
  // behind the drawer. Publishes the current width to CSS (see global.css);
  // fully self-contained (root class + var only), so it survives a fumadocs
  // upgrade with no merge surface.
  useEffect(() => {
    const root = document.documentElement;
    if (open) {
      root.style.setProperty('--ciele-ai-width', `${width}px`);
      root.classList.add('ciele-ai-open');
    } else {
      root.classList.remove('ciele-ai-open');
      root.style.removeProperty('--ciele-ai-width');
    }
    return () => {
      root.classList.remove('ciele-ai-open');
      root.style.removeProperty('--ciele-ai-width');
    };
  }, [open, width]);

  if (!ASSISTANT_ID) return null;
  // Forward the site theme so the embedded widget matches light/dark instead of
  // guessing (it cannot read its host page's theme cross-origin).
  const chatSrc = `${WIDGET_ORIGIN}/widget/${ASSISTANT_ID}?theme=${dark ? 'dark' : 'light'}`;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ciele-ask-ai fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-2xl bg-fd-secondary px-4 py-2 text-sm font-medium text-fd-secondary-foreground shadow-lg ring-1 ring-fd-border transition-colors hover:bg-fd-accent"
        >
          <ChatBubbleIcon />
          Ask AI
        </button>
      )}

      {open && (
        <aside
          ref={containerRef}
          role="dialog"
          aria-label="Ask AI"
          style={{ width: fullscreen ? '100vw' : width, maxWidth: '100vw' }}
          // The width tween is what makes drawer ↔ full screen read as one
          // motion; easeOutBack gives it the small overshoot. Dropped while
          // dragging the edge (the width must track the pointer) and under
          // prefers-reduced-motion.
          className={`fixed inset-y-0 right-0 z-50 flex h-dvh max-sm:!w-full flex-col border-l border-fd-border bg-fd-popover text-fd-popover-foreground shadow-2xl${
            resizing
              ? ''
              : ' transition-[width] duration-[420ms] ease-[cubic-bezier(.34,1.42,.64,1)] motion-reduce:transition-none'
          }`}
        >
          {/* Drag handle, same behavior/look as the app's preview panel. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            onPointerDown={(e) => {
              e.preventDefault();
              beginResize();
            }}
            className="group absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize sm:block"
          >
            <div
              className={`absolute inset-y-0 left-1/2 w-[7px] -translate-x-1/2 bg-neutral-400/20 transition-opacity ${resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            />
            <div
              className={`absolute inset-y-0 left-1/2 w-[2.5px] -translate-x-1/2 bg-neutral-400 transition-opacity ${resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            />
            <div
              className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-neutral-400 bg-white py-1.5 shadow-sm transition-opacity dark:bg-neutral-950 ${resizing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              <GripVertical className="size-4 text-neutral-400" />
            </div>
          </div>

          {/* The embedded assistant owns the chat controls, including close. */}
          <iframe
            src={chatSrc}
            title="Ciele assistant"
            className={`h-full w-full border-0${resizing ? ' pointer-events-none' : ''}`}
            allow="clipboard-write; microphone"
          />
        </aside>
      )}
    </>
  );
}
