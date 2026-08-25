"use client";

import {
  Ellipsis,
  History,
  Maximize2,
  MessageSquareText,
  Minimize2,
  SquarePen,
  X,
} from "lucide-react";
import { Button, Hint } from "@agent-hub/ui";
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
 */
export function ChatHeader({
  nickname,
  avatarUrl,
  historyOpen,
  onToggleHistory,
  onNewChat,
  onClose,
  fullscreen,
  onToggleFullscreen,
  onSendFeedback,
}: {
  nickname: string;
  avatarUrl?: string | null;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onNewChat: () => void;
  onClose?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onSendFeedback?: () => void;
}) {
  // Icons use the theme foreground token (via `text-primary`) rather than the
  // brand color: a dark brand color is invisible on the dark-mode surface, so
  // the header must flip white in dark, same as the rest of the chrome.
  return (
    <div className="flex items-center gap-1 border-b px-3 py-3">
      <Hint label="View history">
        <Button
          variant="ghost"
          size="icon"
          aria-label="View history"
          className={
            historyOpen ? "border-primary/40 bg-primary/10 border" : undefined
          }
          onClick={onToggleHistory}
        >
          <History className="text-primary size-4" />
        </Button>
      </Hint>

      <span className="flex flex-1 items-center justify-center gap-2 text-lg font-medium">
        {avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="size-7 rounded-full object-cover"
          />
        )}
        <span>{nickname}</span>
      </span>

      <Hint label="New chat">
        <Button
          variant="ghost"
          size="icon"
          aria-label="New chat"
          onClick={onNewChat}
        >
          <SquarePen className="text-primary size-4" />
        </Button>
      </Hint>
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
                  <Maximize2 className="size-4" /> Open full screen
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
