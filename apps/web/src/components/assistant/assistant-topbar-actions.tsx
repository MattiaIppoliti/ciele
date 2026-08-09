"use client";

import { useEffect } from "react";
import { AssistantOptionsMenu } from "@/components/assistant/assistant-options-menu";
import { CopyIdButton } from "@/components/assistant/copy-id-button";
import { useShell } from "@/components/shell/shell-provider";

/**
 * Registers the assistant identity strip (id + copy + Duplicate/Delete) into
 * the global top bar, so it shares a row with the page title instead of its
 * own otherwise-empty strip. Renders nothing itself.
 */
export function AssistantTopBarActions({
  assistantId,
  assistantTitle,
  canEdit,
  canDelete,
}: {
  assistantId: string;
  assistantTitle: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { setTopBarActions } = useShell();

  useEffect(() => {
    setTopBarActions(
      <>
        {/* The raw id is reference material, not a control — on a phone header
            it would crowd out the page title. The copy button next to it still
            puts it on the clipboard at every size. */}
        <code className="text-muted-foreground hidden font-mono text-xs md:inline">
          {assistantId}
        </code>
        {/* The options menu carries its own "Copy ID", so the standalone
            button can leave the phone header rather than crowd the title. */}
        <span className="hidden sm:contents">
          <CopyIdButton id={assistantId} />
        </span>
        <AssistantOptionsMenu
          assistantId={assistantId}
          assistantTitle={assistantTitle}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      </>
    );
    return () => setTopBarActions(null);
  }, [assistantId, assistantTitle, canEdit, canDelete, setTopBarActions]);

  return null;
}
