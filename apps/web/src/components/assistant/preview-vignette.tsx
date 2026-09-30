"use client";

import { useRouter } from "next/navigation";
import { ArrowUp, Ellipsis, Plus, SquarePen, X } from "lucide-react";
import type { Assistant } from "@agent-hub/core";
import { useShell } from "@/components/shell/shell-provider";
import { ChatHeaderMock } from "./preview-peek";
import { previewPanelCode } from "./preview-panel-loader";

/**
 * The Overview's picture of the widget, and its way into the live Preview.
 *
 * It is the Preview's chat card as it opens (the same header row, the same
 * welcome text, the same composer), so selecting it and watching the rail slide
 * in shows the thing the Member was already looking at, now working. It lights
 * on hover the way a Find preview page does: the edge brightens and a glow
 * rises from the top, in the same ink, so the two read as one family of
 * "this opens".
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
      type="button"
      onClick={open}
      onPointerEnter={previewPanelCode.prefetch}
      onFocus={previewPanelCode.prefetch}
      aria-label={`Open the Preview of ${nickname}`}
      className="group/page bg-card border-foreground/15 hover:border-foreground/30 focus-visible:ring-ring relative flex min-h-64 flex-col overflow-hidden rounded-xl border text-left transition-[border-color,box-shadow] duration-300 outline-none hover:shadow-[0_0_18px_-4px_color-mix(in_srgb,var(--foreground)_16%,transparent)] focus-visible:ring-2 motion-reduce:transition-none"
    >
      {/* The light, on the chat card itself rather than on a frame around it:
          one card, the one the Preview opens. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/page:opacity-100 motion-reduce:transition-none [background:radial-gradient(120%_70%_at_50%_0%,color-mix(in_srgb,var(--foreground)_10%,transparent),transparent_70%)]"
      />
      <span
        aria-hidden
        className="from-foreground/[0.11] group-hover/page:from-foreground/[0.22] pointer-events-none absolute inset-x-0 top-0 h-11 bg-gradient-to-b to-transparent transition-[height,--tw-gradient-from] duration-300 group-hover/page:h-24 motion-reduce:transition-none"
      />

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
    </button>
  );
}
