"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  Improvement,
  ImprovementAssociation,
  ImprovementProposal,
} from "@agent-hub/core";
import { Maximize2, X } from "lucide-react";
import { Button, Hint, Skeleton } from "@agent-hub/ui";
import {
  ResizeHandle,
  useResizableWidth,
} from "@/components/ui/resizable-panel";
import { getImprovementDetailAction } from "@/app/actions";
import { ImprovementDetail } from "./improvement-detail";

const PANEL_MIN_WIDTH = 480;
const PANEL_DEFAULT_WIDTH = 760;
const PANEL_MAX_WIDTH = 1400;

interface Detail {
  improvement: Improvement;
  associations: ImprovementAssociation[];
  proposal: ImprovementProposal | null;
}

/**
 * Right-side drawer over the Improvements board: the same screen the detail
 * route renders, without leaving the board. Resizable with the chat preview
 * panel's handle; "Open full screen" hands off to `/improvements/{id}`.
 */
export function ImprovementDrawer({
  improvementId,
  members,
  canEdit,
  onClose,
}: {
  improvementId: string;
  members: Array<{ userId: string; email: string }>;
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const { width, resizing, setResizing, containerRef } = useResizableWidth({
    defaultWidth: PANEL_DEFAULT_WIDTH,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: PANEL_MAX_WIDTH,
  });

  // The board keys this component by improvement id, so a different id mounts a
  // fresh drawer, the effect only has to fetch, never reset.
  useEffect(() => {
    let live = true;
    getImprovementDetailAction(improvementId).then((result) => {
      if (!live) return;
      if (result) setDetail(result);
      else setMissing(true);
    });
    return () => {
      live = false;
    };
  }, [improvementId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden
      />
      <aside
        ref={containerRef}
        role="dialog"
        aria-label="Improvement"
        style={{ width }}
        className="bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-full flex-col border-l shadow-xl"
      >
        <ResizeHandle
          resizing={resizing}
          onPointerDown={() => setResizing(true)}
          label="Resize improvement panel"
        />
        <header className="flex shrink-0 items-center justify-end gap-1 px-3 py-2">
          <Hint label="Open full screen">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open full screen"
              onClick={() => router.push(`/improvements/${improvementId}`)}
            >
              <Maximize2 className="size-4" />
            </Button>
          </Hint>
          <Hint label="Close">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close improvement panel"
              onClick={onClose}
            >
              <X className="size-5" />
            </Button>
          </Hint>
        </header>

        {/* Inner scroll container, overflow lives here, not on the aside, so
            the handle poking out at -left-1.5 isn't clipped. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {detail ? (
            <ImprovementDetail
              improvement={detail.improvement}
              associations={detail.associations}
              members={members}
              proposal={detail.proposal}
              canEdit={canEdit}
              variant="drawer"
            />
          ) : missing ? (
            <p className="text-muted-foreground px-6 py-10 text-center text-sm">
              This improvement no longer exists.
            </p>
          ) : (
            <div className="space-y-4 px-6 py-5" aria-busy="true">
              <Skeleton className="h-7 w-64" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
