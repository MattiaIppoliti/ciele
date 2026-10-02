"use client";

import { useRouter } from "next/navigation";
import { ArrowUpRight, ArrowUp, MessageSquare, Ellipsis, Plus, SquarePen, X } from "lucide-react";
import type { Assistant } from "@agent-hub/core";
import { useShell } from "@/components/shell/shell-provider";
import { ChatHeaderMock } from "./preview-peek";
import { previewPanelCode } from "./preview-panel-loader";

/**
 * The Overview's picture of the widget, and its way into the live Preview.
 *
 * It is the Preview's chat card as it opens (the same header row, the same
 * welcome text, the same composer), so selecting it and watching the rail slide
 * in shows the thing the Member was already looking at, now working. The
 * Overview's shared frame stays dark while its inner surface and destination
 * arrow brighten on hover or keyboard focus.
 *
 * Below `md` there is no right rail to open, so it goes to the Preview route,
 * which is the same panel as a page.
 */
export function PreviewVignette({ assistant, base }: { assistant: Assistant; base: string }) {
  const { openRightRail } = useShell();
  const router = useRouter();
  const nickname = assistant.nickname || assistant.title;

  function open() {
    if (window.matchMedia("(min-width: 48rem)").matches) openRightRail("preview");
    else router.push(`${base}/preview`);
  }

  return (
    <button
      data-slot="overview-card"
      type="button"
      onClick={open}
      onPointerEnter={previewPanelCode.prefetch}
      onFocus={previewPanelCode.prefetch}
      aria-label={`Open the Preview of ${nickname}`}
      className="overview-card press focus-visible:ring-ring relative flex min-h-64 flex-col text-left outline-none focus-visible:ring-2"
    >
      <span
        data-slot="overview-card-content"
        className="overview-card-content relative flex min-w-0 flex-1 flex-col p-1"
      >
        {/* `ChatHeader`'s row, the transcript's welcome message and the
            composer under it. */}
        <ChatHeaderMock aria-hidden className="relative" nickname={nickname}>
          <span className="flex shrink-0 items-center">
            <span className="flex size-9 items-center justify-center">
              <SquarePen className="text-primary size-4" />
            </span>
            <span className="flex size-9 items-center justify-center">
              <Ellipsis className="text-primary size-4" />
            </span>
            <span className="flex size-9 items-center justify-center">
              <X className="text-primary size-4" />
            </span>
          </span>
        </ChatHeaderMock>
        <span aria-hidden className="relative line-clamp-4 flex-1 px-4 py-5 text-[0.9375rem]">
          {assistant.welcomeMessage || "Hi! How can I help?"}
        </span>
        <span
          aria-hidden
          className="bg-background/60 relative mx-3 mb-3 flex flex-col gap-3 rounded-2xl border px-4 py-3"
        >
          <span className="text-muted-foreground truncate text-sm">Ask {nickname}…</span>
          <span className="flex items-center justify-between">
            <Plus className="text-muted-foreground size-4" />
            <span className="bg-primary/40 text-primary-foreground flex size-8 items-center justify-center rounded-full">
              <ArrowUp className="size-4" />
            </span>
          </span>
        </span>
      </span>
      <span
        data-slot="overview-card-caption"
        aria-hidden
        className="overview-card-caption overview-card-link text-muted-foreground relative flex items-center gap-3 px-3 py-3 text-sm font-medium"
      >
        <span
          data-slot="overview-card-icon"
          className="overview-card-icon flex size-9 shrink-0 items-center justify-center rounded-full"
        >
          <MessageSquare className="size-4" />
        </span>
        <span className="flex-1">Open Preview</span>
        <ArrowUpRight className="overview-card-arrow size-4" />
      </span>
    </button>
  );
}
