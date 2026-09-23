"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { setDocumentExcludedAction } from "@/app/actions";
import { toast } from "@/lib/toast";

/**
 * The one control on the Document route (#928): keep this Document out of
 * retrieval, or put it back.
 *
 * Optimistic, and honest about failing: the switch moves at once because the
 * re-embed on restore can take a second, and it moves back with the error if
 * the server refuses. A Viewer never gets this component, only the state it
 * would have set.
 */
export function DocumentExcludeToggle({
  sourceId,
  documentId,
  excluded,
}: {
  sourceId: string;
  documentId: string;
  excluded: boolean;
}) {
  const [on, setOn] = useState(excluded);
  const [isPending, startTransition] = useTransition();

  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">Excluded from retrieval</span>
      <Switch
        checked={on}
        disabled={isPending}
        aria-label="Exclude this Document from retrieval"
        onCheckedChange={(next: boolean) => {
          setOn(next);
          startTransition(async () => {
            try {
              await setDocumentExcludedAction(sourceId, documentId, next);
              toast.success(
                next
                  ? "Excluded. It stays here and leaves the search index."
                  : "Restored. It is being indexed again."
              );
            } catch (error) {
              setOn(!next);
              toast.error(
                error instanceof Error ? error.message : "Could not save that"
              );
            }
          });
        }}
      />
    </label>
  );
}
