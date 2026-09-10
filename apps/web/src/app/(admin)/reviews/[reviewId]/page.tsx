import { notFound } from "next/navigation";
import { canDecideReview } from "@agent-hub/core";
import { verifyReviewLinkToken } from "@agent-hub/agent";
import { ReviewDecision } from "@/components/reviews/review-decision";
import { requirePageMember } from "@/lib/authz";

export const dynamic = "force-dynamic";

/**
 * The decision page a Human review's link opens (#841). Signed in as a Member
 * of the Organization is the gate; the link's token, when present, is checked
 * so a tampered or foreign link fails here rather than reading as a page with
 * nothing on it. Without a token (the Inbox's own link) the page still opens:
 * the row's RLS and the decide operation carry the real rules.
 */
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ reviewId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reviewId } = await params;
  const { t } = await searchParams;
  const { organizationId, role, db, session } = await requirePageMember();
  if (typeof t === "string") {
    const verdict = verifyReviewLinkToken(t);
    if (!verdict.ok || verdict.reviewId !== reviewId) notFound();
  }
  const review = await db.table("reviewRequests").get(reviewId);
  if (!review || review.organizationId !== organizationId) notFound();
  const [assistant, conversation] = await Promise.all([
    db.getAssistant(review.assistantId),
    db.getConversation(review.conversationId),
  ]);
  return (
    <ReviewDecision
      review={review}
      assistantTitle={assistant?.title ?? "Assistant"}
      conversationTitle={conversation?.title ?? ""}
      mayDecide={canDecideReview(review, { email: session.email, role })}
    />
  );
}
