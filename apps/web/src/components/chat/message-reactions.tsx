"use client";

import { RollingNumber } from "@/components/motion/rolling-number";

import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SmilePlus } from "lucide-react";
import { createReactionSession } from "@/lib/reaction-session";
import { groupMessageReactions, QUICK_REACTIONS } from "@/lib/message-reactions";
import { cn } from "@/lib/utils";

const EmojiPicker = lazy(() => import("./emoji-picker"));

export interface ReactionTarget {
  messageId: string;
  channelId?: string;
  assistantId?: string;
  visitorId?: string;
}

/** Shared across Preview, published widget, private Teammates and groups. */
export function MessageReactions({ target, children, presentation = "chat" }: { target: ReactionTarget; children: ReactNode; presentation?: "chat" | "comment" }) {
  const query = new URLSearchParams({ messageId: target.messageId });
  if (target.channelId) query.set("channelId", target.channelId);
  if (target.assistantId) query.set("assistantId", target.assistantId);
  if (target.visitorId) query.set("visitorId", target.visitorId);
  const endpoint = `/api/chat/reactions?${query}`;
  return <ReactionControls key={endpoint} endpoint={endpoint} presentation={presentation}>{children}</ReactionControls>;
}

function ReactionControls({ endpoint, children, presentation }: { endpoint: string; children: ReactNode; presentation: "chat" | "comment" }) {
  const [session] = useState(() => createReactionSession(endpoint));
  const { reactions, available, actorId, saving, error } = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [more, setMore] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void session.load();
    return () => session.close();
  }, [session]);

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !trigger.current?.contains(event.target)) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setMenu(null); trigger.current?.focus(); }
    };
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [menu]);

  function open(x: number, y: number) {
    setMore(false);
    setMenu({ x: Math.max(8, Math.min(x, window.innerWidth - 252)), y: Math.max(8, Math.min(y, window.innerHeight - 56)) });
  }

  async function toggle(emoji: string) {
    if (await session.toggle(emoji)) {
      setMenu(null);
      trigger.current?.focus();
    }
  }

  return (
    <div ref={root} className={cn("group/reaction relative", presentation === "comment" ? "flex flex-wrap items-center gap-1.5" : ["pt-1", reactions.length > 0 && "pt-5"])} onContextMenu={(event) => {
      if (!available) return;
      event.preventDefault(); event.stopPropagation(); open(event.clientX, event.clientY);
    }} onKeyDown={(event) => {
      if (!available) return;
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        const bounds = root.current?.getBoundingClientRect();
        if (bounds) open(bounds.right - 244, bounds.top);
      }
    }}>
      {children}
      <div className={presentation === "comment" ? "order-first flex max-w-full flex-wrap gap-1" : "absolute -top-3 right-1 flex max-w-full flex-wrap justify-end gap-1"}>
        {groupMessageReactions(reactions).map(({ emoji, actors }) => (
          <span key={emoji} className="group/badge relative">
            <button type="button" disabled={saving} aria-label={`${emoji}: ${actors.map((a) => a.actorName).join(", ")}`} aria-pressed={actors.some((a) => a.actorId === actorId)} onClick={() => void toggle(emoji)} className={cn("press-control flex items-center justify-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", presentation === "comment" ? "h-7 border bg-background px-2 text-xs aria-pressed:bg-primary/10 aria-pressed:border-primary/40" : "min-h-8 min-w-8 border-2 border-background bg-brand px-1.5 text-lg shadow-light")}>
              {emoji}{(presentation === "comment" || actors.length > 1) && <span className="text-xs"><RollingNumber value={actors.length} /></span>}
            </button>
            <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-40 mt-1 w-max max-w-64 rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground opacity-0 shadow-strong transition-opacity group-hover/badge:opacity-100 group-focus-within/badge:opacity-100">
              {actors.map((a) => a.actorName).join(", ")}
            </span>
          </span>
        ))}
      </div>
      {available && <button ref={trigger} type="button" aria-label="Add reaction" aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={() => {
        if (menu) { setMenu(null); return; }
        const bounds = trigger.current?.getBoundingClientRect();
        if (bounds) open(bounds.left, bounds.bottom + 4);
      }} className={cn("press-control grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", presentation === "chat" && "mt-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/reaction:opacity-100 sm:group-focus-within/reaction:opacity-100")}>
        <SmilePlus className="size-3.5" />
      </button>}
      {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
      {menu && createPortal(
        <div ref={menuRef} role={more ? "dialog" : "menu"} aria-label={more ? "Choose an emoji" : "React to response"} style={{ left: Math.min(menu.x, Math.max(8, window.innerWidth - (more ? 328 : 252))), top: Math.min(menu.y, Math.max(8, window.innerHeight - (more ? 432 : 56))) }} className={cn("fixed z-[100] max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border bg-popover/95 text-popover-foreground shadow-strong backdrop-blur-xl", more ? "w-80" : "w-[244px] p-1.5")} onKeyDown={(event) => {
          if (more || event.target instanceof HTMLInputElement) return;
          if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
          const index = buttons.findIndex((button) => button === document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}>
          {more ? (
            <Suspense fallback={<p role="status" className="p-4 text-xs text-muted-foreground">Loading emojis…</p>}>
              <EmojiPicker onSelect={(emoji) => void toggle(emoji)} onBack={() => setMore(false)} selected={reactions.filter((reaction) => reaction.actorId === actorId).map((reaction) => reaction.emoji)} disabled={saving} />
            </Suspense>
          ) : (
            <div className="flex items-center justify-between gap-0.5">
              {QUICK_REACTIONS.map((emoji) => <button key={emoji} type="button" role="menuitemcheckbox" aria-label={emoji} aria-checked={reactions.some((r) => r.emoji === emoji && r.actorId === actorId)} disabled={saving} onClick={() => void toggle(emoji)} className={cn("press-control grid size-7 place-items-center rounded-full text-lg leading-none hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", reactions.some((r) => r.emoji === emoji && r.actorId === actorId) && "ring-2 ring-ring")} >{emoji}</button>)}
              <button type="button" role="menuitem" aria-label="More emoji" aria-haspopup="dialog" onClick={() => setMore(true)} className="press-control grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><SmilePlus className="size-4" /></button>
            </div>
          )}
        </div>, document.body,
      )}
    </div>
  );
}
