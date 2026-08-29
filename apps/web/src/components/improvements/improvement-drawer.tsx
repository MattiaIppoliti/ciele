"use client";

import { useEffect, useState } from "react";
import type {
  Improvement,
  ImprovementAssociationPage,
  ImprovementProposal,
} from "@agent-hub/core";
import { Button, Skeleton } from "@agent-hub/ui";
import { DetailDrawer } from "@/components/ui/detail-drawer";
import { getImprovementDetailAction } from "@/app/actions";
import { ImprovementDetail } from "./improvement-detail";

interface Detail {
  improvement: Improvement;
  associationPage: ImprovementAssociationPage;
  proposal: ImprovementProposal | null;
  projects: { id: string; name: string }[];
}

/**
 * Right-side drawer over the Improvements board: the same screen the detail
 * route renders, without leaving the board. The shell, the resize handle and
 * full-screen state come from the console's shared `DetailDrawer`. Expanding
 * keeps this loaded instance mounted, so it does not navigate or fetch again.
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
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);

  // The board keys this component by improvement id, so a different id mounts a
  // fresh drawer, the effect only has to fetch, never reset.
  useEffect(() => {
    let live = true;
    getImprovementDetailAction(improvementId)
      .then((result) => {
        if (!live) return;
        if (result) setDetail(result);
        else setMissing(true);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [improvementId, attempt]);

  return (
    <DetailDrawer
      ariaLabel="Improvement"
      fullScreen={fullScreen}
      onFullScreenChange={setFullScreen}
      resizeLabel="Resize improvement panel"
      onClose={onClose}
    >
      {detail ? (
        <ImprovementDetail
          improvement={detail.improvement}
          associationPage={detail.associationPage}
          members={members}
          proposal={detail.proposal}
          projects={detail.projects}
          canEdit={canEdit}
          variant="drawer"
        />
      ) : missing ? (
        <p className="text-muted-foreground px-6 py-10 text-center text-sm">
          This improvement no longer exists.
        </p>
      ) : failed ? (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="text-muted-foreground text-sm">
            Could not load this improvement.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className="space-y-4 px-6 py-5" aria-busy="true">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}
    </DetailDrawer>
  );
}
