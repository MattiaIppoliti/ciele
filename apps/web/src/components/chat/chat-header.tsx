"use client";

import { History, SquarePen, X } from "lucide-react";
import { Ellipsis, MessageSquareText, Minimize2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Hint, Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import { AnimatedGlyph } from "@/components/ui/animated-icon";
import { Maximize2Icon } from "@/components/ui/icons/maximize-2";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The chat surface header: ONE component shared by the assistant editor's
 * live Preview panel, the production widget and the Teammate chat, so they can
 * never drift apart (the preview exists to show exactly what production
 * renders).
 *
 * Behavior differences (what "close" means, how fullscreen is realized) are
 * injected by the host through callbacks; everything visual lives here. A
 * callback the host omits takes its control with it: the Teammate chat fills a
 * route of its own, so there is nothing to close and nothing to expand into,
 * and rendering dead buttons would be worse than rendering none (#768).
 *
 * `historyMenu` makes the history button a popover trigger with that content
 * under it (the Teammate chat); without it the button only toggles, and the
 * host draws its own history surface.
 */
export function ChatHeader({
  nickname,
  avatarUrl,
  historyOpen,
  onToggleHistory,
  historyMenu,
  onNewChat,
  onClose,
  fullscreen,
  onToggleFullscreen,
  onSendFeedback,
  headerColor,
  busy = false,
}: {
  nickname: string;
  avatarUrl?: string | null;
  historyOpen?: boolean;
  onToggleHistory?: () => void;
  historyMenu?: ReactNode;
  onNewChat?: () => void;
  onClose?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onSendFeedback?: () => void;
  /** Style-section override for the top bar's background (§4.7 Colors). */
  headerColor?: string;
  /** A turn is streaming: a new chat now would be continued by its tail. */
  busy?: boolean;
}) {
  // Icons use the theme foreground token (via `text-primary`) rather than the
  // brand color: a dark brand color is invisible on the dark-mode surface, so
  // the header must flip white in dark, same as the rest of the chrome.
  const historyButtonClass = historyOpen
    ? "border-primary/40 bg-primary/10 border"
    : undefined;
  return (
    <div
      className="flex shrink-0 items-center gap-1 border-b px-3 py-3"
      style={headerColor ? { backgroundColor: headerColor } : undefined}
    >
      {onToggleHistory && (historyMenu ? (
        <Popover
          open={historyOpen}
          onOpenChange={(open) => {
            if (open !== historyOpen) onToggleHistory();
          }}
        >
          <Hint label="View history">
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="View history"
                  className={historyButtonClass}
                />
              }
            >
              <History className="text-primary size-4" />
            </PopoverTrigger>
          </Hint>
          <PopoverContent
            aria-label="Past conversations"
            className="flex max-h-[min(24rem,var(--available-height))] w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden p-0"
          >
            {historyMenu}
          </PopoverContent>
        </Popover>
      ) : (
        <Hint label="View history">
          <Button
            variant="ghost"
            size="icon"
            aria-label="View history"
            className={historyButtonClass}
            onClick={onToggleHistory}
          >
            <History className="text-primary size-4" />
          </Button>
        </Hint>
      ))}

      <span className="flex min-w-0 flex-1 items-center justify-center gap-2 text-lg font-medium">
        {avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="size-7 shrink-0 rounded-full object-cover"
          />
        )}
        <span className="truncate">{nickname}</span>
      </span>

      {onNewChat && <Hint label="New chat">
        <Button
          variant="ghost"
          size="icon"
          aria-label="New chat"
          disabled={busy}
          onClick={onNewChat}
        >
          <SquarePen className="text-primary size-4" />
        </Button>
      </Hint>}
      {fullscreen && (
        <Hint label="Exit full screen">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Exit full screen"
            onClick={onToggleFullscreen}
          >
            <Minimize2 className="text-primary size-4" />
          </Button>
        </Hint>
      )}
      {(onSendFeedback || onToggleFullscreen) && (
      <DropdownMenu>
        <Hint label="More options">
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="More options" />
            }
          >
            <Ellipsis className="text-primary size-4" />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end" className="w-52">
          {onSendFeedback && (
            <DropdownMenuItem onClick={onSendFeedback}>
              <MessageSquareText className="size-4" /> Send feedback
            </DropdownMenuItem>
          )}
          {onToggleFullscreen && (
            <DropdownMenuItem onClick={onToggleFullscreen}>
              {fullscreen ? (
                <>
                  <Minimize2 className="size-4" /> Exit full screen
                </>
              ) : (
                <>
                  <AnimatedGlyph icon={Maximize2Icon} size={16} /> Open full
                  screen
                </>
              )}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      )}
      {onClose && (
        <Hint label="Close chat">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close chat"
            onClick={onClose}
          >
            <X className="text-primary size-4" />
          </Button>
        </Hint>
      )}
    </div>
  );
}
