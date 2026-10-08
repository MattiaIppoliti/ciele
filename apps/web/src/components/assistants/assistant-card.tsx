"use client";

import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { Assistant } from "@agent-hub/core";
import { CopyPlus, MessageCircle, SlidersHorizontal, Trash2 } from "lucide-react";
import { ChevronRight, Ellipsis } from "lucide-react";
import { toast } from "@/lib/toast";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { duplicateAssistantAction } from "@/app/actions";
import { DeleteAssistantModal } from "@/components/assistants/delete-assistant-modal";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CopyFeedbackIcon,
  Hint,
  useCopyFeedback,
} from "@agent-hub/ui";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  useContextMenuControls,
} from "@/components/motion/context-menu";
import { cn } from "@/lib/utils";
import { formatShortDay } from "@/lib/format";
import { RollInText } from "@/components/motion/roll-in-text";

/** Menu width, so the ⋮ button can right-align the panel under itself. */
const MENU_WIDTH = 224;

/** Opens the card's context menu from the ⋮ button, anchored under it. */
function MoreActionsButton() {
  const { open, openAt } = useContextMenuControls();
  const wasOpen = useRef(false);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="More actions"
      onPointerDown={() => {
        // The outside-pointerdown handler closes the menu before this click
        // lands; remember the state so the button toggles instead of reopening.
        wasOpen.current = open;
      }}
      onClick={(event) => {
        if (wasOpen.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        openAt(
          { x: rect.right - MENU_WIDTH, y: rect.bottom + 4 },
          "pointer",
          { feedback: false }
        );
      }}
    >
      <Ellipsis className="size-4" />
    </Button>
  );
}

/** Bento-style card (grid) or Vercel-style row (list) for one assistant. */
export function AssistantCard({
  assistant,
  canEdit,
  canDelete,
  view = "grid",
  hasPersistentHover = false,
}: {
  assistant: Assistant;
  canEdit: boolean;
  canDelete: boolean;
  view?: "grid" | "list";
  hasPersistentHover?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { copyText, isCopied } = useCopyFeedback<"menu" | "card">();
  const menuCopied = isCopied("menu");
  const cardCopied = isCopied("card");

  async function copyId(source: "menu" | "card") {
    if (await copyText(source, assistant.id)) {
      toast.success("Assistant ID copied");
    } else {
      toast.error("Could not copy the assistant ID");
    }
  }

  function handleDuplicate() {
    startTransition(async () => {
      try {
        const copy = await duplicateAssistantAction(assistant.id);
        toast.success(`Duplicated as “${copy.title}”`);
      } catch {
        toast.error("Could not duplicate the assistant. Try again.");
      }
    });
  }

  const menuContent = (
    <ContextMenuContent
      ariaLabel={`Actions for ${assistant.title}`}
      className="w-56"
    >
      <ContextMenuItem
        textValue="Edit General"
        onSelect={() => router.push(`/assistants/${assistant.id}/general`)}
      >
        <AnimatedIcon icon={SlidersHorizontal} size={16} /> Edit General
      </ContextMenuItem>
      <ContextMenuItem
        textValue="Copy ID"
        closeOnSelect={false}
        onSelect={() => void copyId("menu")}
      >
        <CopyFeedbackIcon copied={menuCopied} className="size-4" />
        <RollInText text={menuCopied ? "Copied" : "Copy ID"} />
      </ContextMenuItem>
      {canEdit && (
        <ContextMenuItem textValue="Duplicate assistant" onSelect={handleDuplicate}>
          <AnimatedIcon icon={CopyPlus} size={16} /> Duplicate assistant
        </ContextMenuItem>
      )}
      {canDelete && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            textValue="Delete"
            tone="destructive"
            onSelect={() => setConfirmDelete(true)}
          >
            <AnimatedIcon icon={Trash2} size={16} /> Delete
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );

  const avatar = (
    <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full border">
      <AnimatedIcon
        icon={MessageCircle}
        size={16}
        iconClassName="text-foreground/70"
      />
    </span>
  );

  const deleteModal = (
    <DeleteAssistantModal
      assistantId={assistant.id}
      assistantTitle={assistant.title}
      open={confirmDelete}
      onClose={() => setConfirmDelete(false)}
      onDeleted={() => setConfirmDelete(false)}
    />
  );

  if (view === "list") {
    return (
      <ContextMenu>
        <ContextMenuTrigger>
      <div
        className={cn(
          "press group relative flex items-center gap-3 overflow-hidden px-4 py-3 transition-colors duration-150 hover:bg-foreground/[0.04] dark:hover:bg-white/[0.06]",
          hasPersistentHover && "bg-foreground/[0.02] dark:bg-white/[0.03]",
          isPending && "opacity-50"
        )}
      >
        <Link
          href={`/assistants/${assistant.id}`}
          aria-label={`Open ${assistant.title}`}
          // The row clips overflow, so the ring is drawn inside it.
          className="focus-visible:ring-ring absolute inset-0 z-[1] outline-none focus-visible:ring-2 focus-visible:ring-inset"
        />

        <div
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 transition-opacity duration-300",
            hasPersistentHover ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-has-[a:focus-visible]:opacity-100"
          )}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.05)_1px,transparent_1px)] bg-[length:4px_4px] dark:bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.02)_1px,transparent_1px)]" />
        </div>
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium"><RollInText text={assistant.title} /></p>
          <p className="text-muted-foreground truncate text-xs">
            <RollInText text={assistant.nickname || assistant.description || assistant.id} />
          </p>
        </div>
        <p className="text-muted-foreground hidden shrink-0 text-xs sm:block">
          Updated {formatShortDay(assistant.updatedAt)}
        </p>
        <div className="z-[2]">
          <MoreActionsButton />
        </div>
        {deleteModal}
      </div>
        </ContextMenuTrigger>
        {menuContent}
      </ContextMenu>
    );
  }

  return (
    <ContextMenu>
    <ContextMenuTrigger>
    <Card
      data-squircle-frame="none"
      className={cn(
        "press group relative h-full gap-2 py-4 ring-0 transition-colors duration-150 hover:bg-muted/40 [--squircle-fill-image:none]",
        hasPersistentHover && "-translate-y-0.5 shadow-light",
        isPending && "opacity-50"
      )}
    >
      <Link
        href={`/assistants/${assistant.id}`}
        aria-label={`Open ${assistant.title}`}
        // The card clips overflow, so the ring is drawn inside it.
        className="focus-visible:ring-ring absolute inset-0 z-[1] rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset"
      />

      <div
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-300",
          hasPersistentHover ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-has-[a:focus-visible]:opacity-100"
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.05)_1px,transparent_1px)] bg-[length:4px_4px] dark:bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.02)_1px,transparent_1px)]" />
      </div>

      <CardHeader className="relative">
        <div className="flex items-center justify-between">
          <span className="bg-foreground/5 flex size-8 items-center justify-center rounded-lg dark:bg-white/10">
            <AnimatedIcon
            icon={MessageCircle}
            size={16}
            iconClassName="text-foreground/70"
          />
          </span>
          <div className="z-[2] flex items-center gap-1">
            <StatusPill status="online" primaryText="Active" />
            <MoreActionsButton />
          </div>
        </div>
      </CardHeader>

      <CardContent className="relative space-y-2">
        <h3 className="text-[0.9375rem] font-medium tracking-tight break-words text-pretty">
          <RollInText text={assistant.title} />
          {assistant.nickname && (
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              <RollInText text={assistant.nickname} />
            </span>
          )}
        </h3>
        {assistant.description && (<p className="text-muted-foreground line-clamp-2 min-h-10 text-sm leading-snug">
          {assistant.description}
        </p>)}
      </CardContent>

      <CardFooter className="relative border-t-0 bg-transparent pt-0 pb-4">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
            <Hint label={cardCopied ? "Assistant ID copied" : `Copy ID: ${assistant.id}`}>
              <Button variant="ghost" size="sm"
                type="button"
                onClick={() => void copyId("card")}
                aria-label={cardCopied ? "Assistant ID copied" : "Copy ID"}
                className="bg-foreground/5 hover:text-foreground focus-visible:ring-ring/50 z-[2] inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 transition-colors outline-none focus-visible:ring-2 dark:bg-white/10"
              >
                <CopyFeedbackIcon copied={cardCopied} className="size-3.5" />
                <span translate="no" className="truncate font-mono">{assistant.id}</span>
              </Button>
            </Hint>
            <span className="bg-foreground/5 shrink-0 rounded-md px-2 py-1 dark:bg-white/10">
              Updated {formatShortDay(assistant.updatedAt)}
            </span>
          </div>
          <span className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-has-[a:focus-visible]:opacity-100">
            Open
            <ChevronRight className="size-3.5" strokeWidth={3} />
          </span>
        </div>
      </CardFooter>

    </Card>
    </ContextMenuTrigger>
    {menuContent}
    {deleteModal}
    </ContextMenu>
  );
}
