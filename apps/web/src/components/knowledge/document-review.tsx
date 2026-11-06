"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { trustTier, verificationEvents, type ConceptFrontmatter } from "@agent-hub/core";
import { Badge, Button } from "@agent-hub/ui";
import { formatDateTime } from "@/lib/format";
import { RollRow, RollInText } from "@/components/motion/roll-in-text";
import { setDocumentReviewAction } from "@/app/(admin)/library/quality-actions";
import { toast } from "@/lib/toast";

export function DocumentReview({ sourceId, documentId, frontmatter, memberId, canEdit, assistantId }: { sourceId: string; documentId: string; frontmatter: ConceptFrontmatter; memberId: string; canEdit: boolean; assistantId?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const reviews = verificationEvents(frontmatter);
  const ownReview = reviews.some(event => event.by === `human:${memberId}`);
  return <div className="space-y-2">
    <p className="text-sm font-medium">Trust</p>
    <Badge variant="secondary"><RollInText text={trustTier(frontmatter)} /></Badge>
    {reviews.map((review, index) => <RollRow key={`${review.by}:${review.at ?? index}`} index={index}><p className="text-muted-foreground text-xs"><RollInText text={`${review.by}${review.at ? ` · ${formatDateTime(review.at)}` : ""}`} /></p></RollRow>)}
    {canEdit && <Button variant="outline" size="sm" disabled={pending} onClick={() => startTransition(async () => {
      try { await setDocumentReviewAction({ sourceId, documentId, assistantId, reviewed: !ownReview }); router.refresh(); toast.success(ownReview ? "Your review was removed" : "Document marked as reviewed"); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Could not update the review"); }
    })}><RollInText text={pending ? "Saving…" : ownReview ? "Remove review" : "Mark as reviewed"} /></Button>}
    <p className="text-muted-foreground text-xs">Editing FAQ text clears its reviews. Re-crawl and Application sync retain reviews only when the body is byte-identical.</p>
  </div>;
}
