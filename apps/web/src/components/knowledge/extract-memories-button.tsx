"use client";

import { useState, useTransition } from "react";
import { Button } from "@agent-hub/ui";
import { extractSourceMemoriesAction } from "@/app/actions";
import { toast } from "@/lib/toast";

/**
 * The backfill lever (#933): ask for memories over a Source's existing
 * Documents.
 *
 * Nothing backfills automatically, so this is how knowledge crawled before the
 * layer existed gets memories without waiting for its next crawl. It is
 * idempotent on the server, and the button reports the number it queued, which
 * is zero on a second press while the first batch is still pending.
 */
export function ExtractMemoriesButton({
  sourceId,
  size = "sm",
}: {
  sourceId: string;
  size?: "sm" | "default";
}) {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  return (
    <Button
      variant="outline"
      size={size}
      disabled={isPending || done}
      onClick={() =>
        startTransition(async () => {
          try {
            const { queued } = await extractSourceMemoriesAction(sourceId);
            setDone(true);
            toast.success(
              queued === 0
                ? "Nothing to extract: every Document is up to date or already queued."
                : `Extracting memories for ${queued} ${
                    queued === 1 ? "Document" : "Documents"
                  }.`
            );
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "Could not start extraction"
            );
          }
        })
      }
    >
      {isPending ? "Queueing…" : "Extract memories"}
    </Button>
  );
}
