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
        <code className="text-muted-foreground font-mono text-xs">
          {assistantId}
        </code>
        <CopyIdButton id={assistantId} />
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
