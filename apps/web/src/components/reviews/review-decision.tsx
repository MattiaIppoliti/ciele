"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { ReviewRequest } from "@agent-hub/core";
import { isReviewOverdue } from "@agent-hub/core";
import { Button, Card, CardContent, Input, Label } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { decideReviewAction } from "@/app/(admin)/reviews/actions";
import { formatDateTime } from "@/lib/format";
import { reviewDecisionLabel } from "@/lib/review-status";
import { toast } from "@/lib/toast";

/**
 * The decision form (#841, stories 50–51): the Inputs, Approve / Reject, and
 * once decided, who decided. Whatever channel brought the assignee here, the
 * answer is typed and recorded against their account.
 */
export function ReviewDecision({
  review: initial,
  assistantTitle,
  conversationTitle,
  mayDecide,
}: {
  review: ReviewRequest;
  assistantTitle: string;
  conversationTitle: string;
  mayDecide: boolean;
}) {
  const [review, setReview] = useState(initial);
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const overdue = isReviewOverdue(review, new Date());
  const open = review.status === "pending" && !overdue;

  function decide(decision: "approved" | "rejected") {
    startTransition(async () => {
      try {
        const result = await decideReviewAction(review.id, decision, values);
        setReview(result.review);
        toast.success(decision === "approved" ? "Approved. The flow continues." : "Rejected.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not record the decision");
      }
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-5">
      <div>
        <p className="text-muted-foreground text-xs font-medium uppercase">Human review</p>
        <h1 className="text-xl font-semibold">{review.title}</h1>
        <p className="text-muted-foreground text-sm">
          {assistantTitle}
          {conversationTitle ? ` · ${conversationTitle}` : ""} · asked {formatDateTime(review.createdAt)}
        </p>
      </div>

      {review.message && (
        <Card>
          <CardContent className="pt-4 text-sm whitespace-pre-wrap">{review.message}</CardContent>
        </Card>
      )}
      {review.summary && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">Conversation so far</p>
            <pre className="whitespace-pre-wrap font-sans text-sm">{review.summary}</pre>
          </CardContent>
        </Card>
      )}

      {!open ? (
        <Card>
          <CardContent className="pt-4 text-sm">
            {review.status === "pending" ? (
              <p>This request expired before anyone decided it.</p>
            ) : (
              <p>
                {reviewDecisionLabel(review)}
                {review.decidedAt ? ` on ${formatDateTime(review.decidedAt)}` : ""}.
              </p>
            )}
            {review.decision && Object.keys(review.decision).length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-2">
                {review.inputs.map((field) => (
                  <div key={field.id}>
                    <dt className="text-muted-foreground text-xs">{field.label}</dt>
                    <dd>{review.decision?.[field.id] ?? ""}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
      ) : !mayDecide ? (
        <Card>
          <CardContent className="pt-4 text-sm">
            Only an assignee ({review.assignees.join(", ")}) or an admin can decide this request.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-4">
            {review.inputs.map((field) => (
              <div key={field.id} className="space-y-1.5">
                <Label>
                  {field.label}
                  {field.required !== false ? " *" : ""}
                </Label>
                {field.type === "long_text" ? (
                  <Textarea
                    value={values[field.id] ?? ""}
                    onChange={(e) => setValues({ ...values, [field.id]: e.target.value })}
                    placeholder={field.placeholder}
                    rows={3}
                  />
                ) : field.type === "dropdown" ? (
                  <Select
                    value={values[field.id] ?? ""}
                    onValueChange={(value) => setValues({ ...values, [field.id]: (value as string) ?? "" })}
                  >
                    <SelectTrigger aria-label={field.label}>
                      <SelectValue>{(value: string) => value || "Choose…"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options ?? []).map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === "yes_no" ? (
                  <div className="flex gap-2">
                    {["Yes", "No"].map((option) => (
                      <Button
                        key={option}
                        type="button"
                        size="sm"
                        variant={values[field.id] === option ? "default" : "outline"}
                        onClick={() => setValues({ ...values, [field.id]: option })}
                      >
                        {option}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Input
                    value={values[field.id] ?? ""}
                    onChange={(e) => setValues({ ...values, [field.id]: e.target.value })}
                    placeholder={field.placeholder}
                  />
                )}
              </div>
            ))}
            <p className="text-muted-foreground text-xs">
              Expires {formatDateTime(review.expiresAt)}. The first decision closes the request.
            </p>
            <div className="flex gap-2">
              <Button type="button" disabled={pending} onClick={() => decide("approved")}>
                Approve
              </Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => decide("rejected")}>
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Link href={`/inbox?conversation=${encodeURIComponent(review.conversationId)}`} className="text-primary text-sm hover:underline">
        Open the conversation in the Inbox →
      </Link>
    </div>
  );
}
