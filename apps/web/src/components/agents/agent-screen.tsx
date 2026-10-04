"use client";

import { useRef, type ReactNode, type RefObject } from "react";
import { Maximize2, Minimize2, PanelRightOpen } from "lucide-react";
import { Button, Dialog, DialogContent, DialogTitle } from "@agent-hub/ui";

/** The supplied Agent Screen frame, fed only by the authenticated computer viewer. */
export function AgentScreen({
  agentName,
  frame,
  activity,
  live,
  current,
  open,
  onOpenChange,
  onOpenWorkspace,
  cardRef,
}: {
  agentName: string;
  frame: ReactNode;
  activity: ReactNode;
  live: boolean;
  /** Earlier turns retain their receipts, not a claim to a historical screen recording. */
  current: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenWorkspace: () => void;
  cardRef?: RefObject<HTMLDivElement | null>;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div ref={cardRef} data-slot="agent-screen" className="w-full max-w-[340px]">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Open ${agentName}'s current screen`}
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
        className="press group/screen relative block aspect-[2964/1856] w-full overflow-hidden rounded-2xl border border-white/10 bg-black text-white shadow-light transition-shadow hover:shadow-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
      >
        {current ? frame : (
          <span className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/70">
            Actions recorded in this turn. Open to see the current screen.
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/screen:bg-black/20 group-focus-visible/screen:bg-black/20 motion-reduce:transition-none">
          <span className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground opacity-0 shadow-light transition-opacity group-hover/screen:opacity-100 group-focus-visible/screen:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none">
            <Maximize2 size={14} aria-hidden />
            Open
          </span>
        </span>
        {live && <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs backdrop-blur-sm">Live</span>}
      </button>
      <div className="mt-2.5 flex items-center justify-between gap-2 px-0.5 text-sm font-medium">
        <span className="truncate">{agentName}&apos;s screen</span>
        <span className="shrink-0 text-xs text-muted-foreground">{current ? "Current screen" : "Earlier turn"}</span>
      </div>
      <div className="mt-1 px-0.5 text-xs text-muted-foreground">{activity}</div>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="z-[105] bg-black/60 dark:bg-black/75"
          className="z-[110] flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1200px] flex-col gap-0 overflow-hidden rounded-2xl bg-[#202023] p-2 pt-0 text-white sm:max-w-[1200px] motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
          finalFocus={triggerRef}
        >
          <header className="flex min-h-[52px] shrink-0 items-center justify-between gap-2 px-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <DialogTitle className="truncate text-sm font-semibold">{agentName}&apos;s current screen</DialogTitle>
              {live && <span className="rounded-full bg-white/10 px-2 py-1 text-xs">Live</span>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px] text-white/70 hover:bg-white/10 hover:text-white" aria-label="Open workspace sidebar" onClick={() => { onOpenChange(false); onOpenWorkspace(); }}>
                <PanelRightOpen size={16} />
              </Button>
              <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px] text-white/70 hover:bg-white/10 hover:text-white" aria-label="Collapse agent screen" onClick={() => onOpenChange(false)}>
                <Minimize2 size={16} />
              </Button>
            </div>
          </header>
          <div className="relative aspect-[2964/1856] min-h-0 max-h-[calc(100dvh-9rem)] overflow-hidden rounded-lg bg-black">{frame}</div>
          <div className="shrink-0 px-1.5 py-2 text-xs text-white/70">{activity}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
