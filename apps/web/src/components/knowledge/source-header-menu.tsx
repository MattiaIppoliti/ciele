"use client";

import { useRouter } from "next/navigation";
import { RefreshCw, Trash2, Unlink } from "lucide-react";
import { Ellipsis } from "lucide-react";
import type { Source } from "@agent-hub/core";
import { Button } from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import {
  deleteOrgSourceAction,
  recrawlSourceAction,
  unlinkSourceAction,
} from "@/app/actions";
import { toast } from "@/lib/toast";

/**
 * The Source's actions, at the top right of its Documents route (#927): the
 * ones the Library row and the Assistant editor already offer, moved to where
 * the reader now is. Editors only; the page renders nothing here for a Viewer.
 *
 * Every item runs the operation the Library runs. Removing the Source leaves
 * the reader on a page about a row that no longer exists, so both removals
 * navigate back to where the breadcrumb points once the server confirms.
 */
export function SourceHeaderMenu({
  source,
  assistantId,
  afterRemoveHref,
}: {
  source: Source;
  /** Inside the Assistant editor: unlink is the gentler removal, offered first. */
  assistantId?: string;
  afterRemoveHref: string;
}) {
  const router = useRouter();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const canRecrawl = source.kind === "website";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              aria-label="Source actions"
              title="Source actions"
            />
          }
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canRecrawl && (
            <DropdownMenuItem
              onSelect={async () => {
                try {
                  await recrawlSourceAction(source.id);
                  toast.success("Re-crawl started.");
                  router.refresh();
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Re-crawl failed"
                  );
                }
              }}
            >
              <RefreshCw className="size-4" />
              Re-crawl now
            </DropdownMenuItem>
          )}
          {assistantId && (
            <DropdownMenuItem
              onSelect={() =>
                confirmDelete({
                  title: <>Remove &ldquo;{source.name}&rdquo; from this assistant?</>,
                  description:
                    "It stays in the Library and keeps answering for any other assistant linked to it.",
                  confirmLabel: "Remove from this assistant",
                  onConfirm: async () => {
                    await unlinkSourceAction(assistantId, source.id);
                    toast.success("Removed.");
                    router.push(afterRemoveHref);
                  },
                })
              }
            >
              <Unlink className="size-4" />
              Remove from this assistant
            </DropdownMenuItem>
          )}
          {(canRecrawl || assistantId) && <DropdownMenuSeparator />}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() =>
              confirmDelete({
                title: <>Delete &ldquo;{source.name}&rdquo;?</>,
                description:
                  "This removes it for every linked assistant at once, including its Documents, their chunks and their memories.",
                onConfirm: async () => {
                  await deleteOrgSourceAction(source.id);
                  toast.success("Deleted.");
                  router.push(afterRemoveHref);
                },
              })
            }
          >
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirmDeleteModal}
    </>
  );
}
