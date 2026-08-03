"use client";

import { useState, useTransition } from "react";
import type { ImprovementListItem, ImprovementStatus } from "@agent-hub/core";
import { toast } from "sonner";
import { updateImprovementAction } from "@/app/actions";
import { improvementKey, statusLabel } from "@/lib/improvements";

/**
 * Lane drag-and-drop for the Improvements tracker, shared by both views: the
 * board owns one instance so the list and the Kanban agree on which card is
 * mid-drag and where the optimistic status sits.
 *
 * Native HTML5 drag-and-drop — a drop only rewrites `status`, since an
 * Improvement has no stored position to reorder within a lane.
 */
export function useImprovementLanes(
  improvements: ImprovementListItem[],
  canEdit: boolean,
) {
  const [overrides, setOverrides] = useState<Record<string, ImprovementStatus>>(
    {},
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropLane, setDropLane] = useState<ImprovementStatus | null>(null);
  const [, startTransition] = useTransition();

  const statusOf = (i: ImprovementListItem): ImprovementStatus =>
    overrides[i.id] ?? i.status;

  function move(id: string, status: ImprovementStatus) {
    const item = improvements.find((i) => i.id === id);
    if (!item || statusOf(item) === status) return;

    setOverrides((prev) => ({ ...prev, [id]: status }));
    startTransition(async () => {
      try {
        await updateImprovementAction(id, { status });
        toast.success(
          `${improvementKey(item.seq)} moved to ${statusLabel(status)}`,
        );
      } catch {
        // Put the card back where the server still has it.
        setOverrides((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        toast.error("Could not move this improvement. Please try again.");
      }
    });
  }

  /** Spread on a card or row to make it draggable between lanes. */
  function dragProps(id: string) {
    return {
      draggable: canEdit,
      onDragStart: (e: React.DragEvent) => {
        // Carry the id so the lane's drop handler knows what moved; the plain
        // text mirror keeps the drag legible to the browser's own preview.
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "move";
        setDraggingId(id);
      },
      onDragEnd: () => {
        setDraggingId(null);
        setDropLane(null);
      },
    };
  }

  /** Spread on a lane container to make it a drop target. */
  function laneProps(status: ImprovementStatus) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!canEdit || !draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropLane(status);
      },
      onDragLeave: () => setDropLane((prev) => (prev === status ? null : prev)),
      onDrop: (e: React.DragEvent) => {
        if (!canEdit) return;
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain") || draggingId;
        setDropLane(null);
        setDraggingId(null);
        if (id) move(id, status);
      },
    };
  }

  return { statusOf, draggingId, dropLane, dragProps, laneProps };
}

export type ImprovementLanes = ReturnType<typeof useImprovementLanes>;
