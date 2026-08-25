"use client";

import { useEffect, useState } from "react";
import type {
  Improvement,
  ImprovementAssociation,
  ImprovementProposal,
} from "@agent-hub/core";
import { Skeleton } from "@agent-hub/ui";
import { DetailDrawer } from "@/components/ui/detail-drawer";
import { getImprovementDetailAction } from "@/app/actions";
import { ImprovementDetail } from "./improvement-detail";

interface Detail {
  improvement: Improvement;
  associations: ImprovementAssociation[];
  proposal: ImprovementProposal | null;
  projects: { id: string; name: string }[];
}

/**
 * Right-side drawer over the Improvements board: the same screen the detail
 * route renders, without leaving the board. The shell, the resize handle and
 * the "Open full screen" hand-off to `/improvements/{id}` are the console's
 * shared `DetailDrawer`; what belongs to this surface is the fetch below and
 * the detail it renders.
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

  return (
    <DetailDrawer
      ariaLabel="Improvement"
      fullScreenHref={`/improvements/${improvementId}`}
      resizeLabel="Resize improvement panel"
      onClose={onClose}
    >
      {detail ? (
        <ImprovementDetail
          improvement={detail.improvement}
          associations={detail.associations}
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
