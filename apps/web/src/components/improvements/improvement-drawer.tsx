"use client";

import { useEffect, useState } from "react";
import type {
  Improvement,
  ImprovementAssociationPage,
  ImprovementProposal,
} from "@agent-hub/core";
import { Button } from "@agent-hub/ui";
import { getImprovementDetailAction } from "@/app/actions";
import { ImprovementDetail } from "./improvement-detail";
import { ImprovementDetailSkeleton } from "./improvement-detail-skeleton";

interface Detail {
  improvement: Improvement;
  associationPage: ImprovementAssociationPage;
  proposal: ImprovementProposal | null;
  projects: { id: string; name: string }[];
}

/** Loaded task content stays mounted while its workspace panel expands. */
export function ImprovementDrawer({
  improvementId,
  members,
  canEdit,
  onUpdated,
  onDeleted,
}: {
  improvementId: string;
  members: Array<{ userId: string; email: string }>;
  canEdit: boolean;
  onUpdated: (improvement: Improvement) => void;
  onDeleted: (improvementId: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
    <>
      {detail ? (
        <ImprovementDetail
          improvement={detail.improvement}
          associationPage={detail.associationPage}
          members={members}
          proposal={detail.proposal}
          projects={detail.projects}
          canEdit={canEdit}
          variant="drawer"
          onUpdated={onUpdated}
          onDeleted={onDeleted}
        />
      ) : (
        // One live region that stays mounted from "loading" to "gone" or
        // "failed", so the change is announced: a region that mounts along
        // with its text is often read by nobody.
        <div role="status" aria-live="polite">
          {missing ? (
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
            <div aria-busy="true">
              <span className="sr-only">Loading improvement…</span>
              <ImprovementDetailSkeleton variant="drawer" />
            </div>
          )}
        </div>
      )}
    </>
  );
}
