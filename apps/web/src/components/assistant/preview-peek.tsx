import { History } from "lucide-react";
import type { Assistant } from "@agent-hub/core";
import { cn } from "@/lib/utils";

/**
 * What the collapsed Preview strip shows on hover: the left slice of the chat
 * card the open panel holds, faded. The strip *is* that card (same top, same
 * bottom, `bg-card`), so this draws only what is inside it, each box repeating
 * a class of the part it stands in for so that opening the panel lands every
 * line where the glimpse already had it:
 *
 * - the header's `px-3 py-3` and its 36px history button from `ChatHeader`;
 * - the body's `px-4 py-5` and the welcome text size from `PreviewPanel`.
 *
 * Static on purpose: mounting the real chat while the rail is closed would
 * fire its requests and its "chat opens" Flows. Plain text rather than
 * `ChatMarkdown`, since the launcher that also draws it has not loaded the
 * chat bundle yet, and the glimpse is too faint to show formatting anyway.
 */
export function PreviewPeek({ assistant }: { assistant: Assistant }) {
  const welcome = (assistant.welcomeMessage ?? "").replace(/[*_#`>[\]]/g, "").trim();
  return (
    <span className="flex min-h-0 flex-1 flex-col">
      <ChatHeaderMock nickname={assistant.nickname || assistant.title}>
        <span className="size-9 shrink-0" />
      </ChatHeaderMock>
      {welcome && <span className="block px-4 py-5 text-[0.9375rem]">{welcome}</span>}
    </span>
  );
}

/**
 * `ChatHeader`'s row, drawn statically: the history button, the centred
 * nickname, and whatever the caller puts at its end (`children`). Shared with
 * the Overview's vignette, which draws the header's buttons there.
 */
export function ChatHeaderMock({
  nickname,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { nickname: string }) {
  return (
    <span
      {...props}
      className={cn(className, "flex items-center gap-1 border-b px-3 py-3")}
    >
      <span className="flex size-9 shrink-0 items-center justify-center">
        <History className="text-primary size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-center text-lg font-medium">{nickname}</span>
      {children}
    </span>
  );
}
