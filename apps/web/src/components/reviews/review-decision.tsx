"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import Link from "next/link";
import type { ReviewInputField, ReviewRequest } from "@agent-hub/core";
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
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { RollInText } from "@/components/motion/roll-in-text";
import { decideReviewAction } from "@/app/(admin)/reviews/actions";
import { formatDateTime } from "@/lib/format";
import { reviewDecisionLabel } from "@/lib/review-status";
import { toast } from "@/lib/toast";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";

type Decision = "approved" | "rejected";

/**
 * Required the way `decideReview` enforces it: only an explicit `true`, and
 * only when approving. The asterisk used to read `!== false`, which starred
 * fields the server would accept empty.
 */
function isRequired(field: ReviewInputField): boolean {
  return field.required === true;
}

/** formatDateTime renders in UTC; say so, since the reader's clock may not be. */
function utc(iso: string): string {
  return `${formatDateTime(iso)} UTC`;
}

const noopSubscribe = () => () => {};

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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [justDecided, setJustDecided] = useState(false);
  const [pending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const idPrefix = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  // "Overdue" depends on the clock, and the server's clock at render is not
  // the browser's at hydration, so the server renders the form and the client
  // decides after mount. The subscription flips it the moment the request
  // expires on an open page, instead of letting a stale form accept a click.
  const { expiresAt, status } = review;
  const subscribeToExpiry = useCallback(
    (notify: () => void) => {
      if (status !== "pending") return () => {};
      const ms = Date.parse(expiresAt) - Date.now();
      // setTimeout overflows past ~24.8 days; nobody keeps a tab open that long.
      if (ms <= 0 || ms > 2 ** 31 - 1) return () => {};
      const timer = window.setTimeout(notify, ms);
      return () => window.clearTimeout(timer);
    },
    [expiresAt, status],
  );
  const overdue = useSyncExternalStore(
    status === "pending" ? subscribeToExpiry : noopSubscribe,
    () => isReviewOverdue({ status, expiresAt }, new Date()),
    () => false,
  );
  const open = review.status === "pending" && !overdue;
  const busy = pending || deciding !== null;

  // Typed answers vanish with the tab, and the request may expire before
  // anyone types them again.
  const hasTyped = Object.values(values).some((value) => value.trim() !== "");
  const guardUnload = open && mayDecide && hasTyped;
  useUnsavedChanges({ dirty: guardUnload });

  // The form is replaced by the outcome, which would strand focus on a
  // removed button; hand it to the card that says what happened.
  useEffect(() => {
    if (justDecided) resultRef.current?.focus();
  }, [justDecided]);

  function setValue(fieldId: string, value: string) {
    setValues((current) => ({ ...current, [fieldId]: value }));
    if (errors[fieldId]) {
      setErrors((current) => {
        const next = { ...current };
        delete next[fieldId];
        return next;
      });
    }
  }

  /** Checks the Approve rule locally, so a gap is marked on the field, not in a toast. */
  function validate(decision: Decision): boolean {
    if (decision !== "approved" || review.simulated) {
      setErrors({});
      return true;
    }
    const next: Record<string, string> = {};
    for (const field of review.inputs) {
      if (isRequired(field) && !(values[field.id] ?? "").trim()) {
        next[field.id] = "Required to approve.";
      }
    }
    setErrors(next);
    const first = review.inputs.find((field) => next[field.id]);
    if (first) {
      fieldRefs.current[first.id]?.focus();
      return false;
    }
    return true;
  }

  /** Resolves either way, so the confirm dialog can await it and then close. */
  async function submit(decision: Decision) {
    setDeciding(decision);
    try {
      const result = await decideReviewAction(review.id, decision, values);
      setReview(result.review);
      setJustDecided(true);
      toast.success(
        decision === "approved" ? "Approved. The flow continues." : "Rejected.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not record the decision",
      );
    } finally {
      setDeciding(null);
    }
  }

  function requestDecision(decision: Decision) {
    if (!validate(decision)) return;
    if (decision === "rejected") {
      // The first decision closes the request for every assignee, and a
      // rejection halts the flow, so it gets a second look.
      confirmDelete({
        title: "Reject this request?",
        description:
          "The flow stops and the Visitor reads the halt message. Nobody can decide this request again.",
        confirmLabel: "Reject",
        onConfirm: () => submit("rejected"),
      });
      return;
    }
    startTransition(() => submit("approved"));
  }

  const labelId = (field: ReviewInputField) => `${idPrefix}-${field.id}-label`;
  const inputId = (field: ReviewInputField) => `${idPrefix}-${field.id}`;
  const errorId = (field: ReviewInputField) => `${idPrefix}-${field.id}-error`;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-5">
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-medium uppercase">Human review</p>
        <h1 className="text-xl font-semibold [overflow-wrap:anywhere]">{review.title}</h1>
        <p className="text-muted-foreground text-sm [overflow-wrap:anywhere]">
          {assistantTitle}
          {conversationTitle ? ` · ${conversationTitle}` : ""} · asked {utc(review.createdAt)}
        </p>
      </div>

      {review.message && (
        <Card>
          <CardContent className="pt-4 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
            {review.message}
          </CardContent>
        </Card>
      )}
      {review.summary && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">Conversation so far</p>
            <pre className="whitespace-pre-wrap font-sans text-sm [overflow-wrap:anywhere]">
              {review.summary}
            </pre>
          </CardContent>
        </Card>
      )}

      {!open ? (
        <Card
          ref={resultRef}
          tabIndex={-1}
          role="status"
          className="outline-none"
        >
          <CardContent className="pt-4 text-sm">
            {review.status === "pending" ? (
              <p>This request expired before anyone decided it.</p>
            ) : (
              <p className="[overflow-wrap:anywhere]">
                {reviewDecisionLabel(review)}
                {review.decidedAt ? ` on ${utc(review.decidedAt)}` : ""}.
              </p>
            )}
            {review.decision && Object.keys(review.decision).length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-2">
                {review.inputs.map((field) => (
                  <div key={field.id} className="min-w-0">
                    <dt className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
                      {field.label}
                    </dt>
                    <dd className="[overflow-wrap:anywhere]">
                      {review.decision?.[field.id] ?? ""}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
      ) : !mayDecide ? (
        <Card>
          <CardContent className="pt-4 text-sm [overflow-wrap:anywhere]">
            Only an assignee ({review.assignees.join(", ")}) or an admin can decide this request.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-4">
            {review.inputs.map((field) => {
              const required = isRequired(field);
              const error = errors[field.id];
              const invalid = error ? true : undefined;
              const describedBy = error ? errorId(field) : undefined;
              const bind = (element: HTMLElement | null) => {
                fieldRefs.current[field.id] = element;
              };
              return (
                <div key={field.id} className="min-w-0 space-y-1.5">
                  <Label
                    id={labelId(field)}
                    htmlFor={field.type === "yes_no" ? undefined : inputId(field)}
                    className="[overflow-wrap:anywhere]"
                  >
                    {field.label}
                    {required ? (
                      <span aria-hidden className="text-muted-foreground">
                        {" *"}
                      </span>
                    ) : null}
                  </Label>
                  {field.type === "long_text" ? (
                    <Textarea
                      ref={bind}
                      id={inputId(field)}
                      value={values[field.id] ?? ""}
                      onChange={(e) => setValue(field.id, e.target.value)}
                      placeholder={field.placeholder}
                      required={required}
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                      rows={3}
                    />
                  ) : field.type === "dropdown" ? (
                    <Select
                      value={values[field.id] ?? ""}
                      onValueChange={(value) => setValue(field.id, (value as string) ?? "")}
                    >
                      <SelectTrigger
                        ref={bind}
                        id={inputId(field)}
                        aria-label={field.label}
                        aria-required={required || undefined}
                        aria-invalid={invalid}
                        aria-describedby={describedBy}
                      >
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
                    <div
                      role="radiogroup"
                      aria-labelledby={labelId(field)}
                      aria-required={required || undefined}
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                      className="flex gap-2"
                    >
                      {["Yes", "No"].map((option, index) => (
                        <Button
                          key={option}
                          ref={index === 0 ? bind : undefined}
                          type="button"
                          size="sm"
                          role="radio"
                          aria-checked={values[field.id] === option}
                          variant={values[field.id] === option ? "default" : "outline"}
                          onClick={() => setValue(field.id, option)}
                        >
                          {option}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <Input
                      ref={bind}
                      id={inputId(field)}
                      value={values[field.id] ?? ""}
                      onChange={(e) => setValue(field.id, e.target.value)}
                      placeholder={field.placeholder}
                      required={required}
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                    />
                  )}
                  {error && (
                    <p id={errorId(field)} className="text-destructive text-xs">
                      {error}
                    </p>
                  )}
                </div>
              );
            })}
            <p className="text-muted-foreground text-xs">
              Expires {utc(review.expiresAt)}. The first decision closes the request.
            </p>
            <div className="flex gap-2">
              <Button type="button" disabled={busy} onClick={() => requestDecision("approved")}>
                <RollInText text={deciding === "approved" ? "Recording…" : "Approve"} />
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => requestDecision("rejected")}
              >
                <RollInText text={deciding === "rejected" ? "Recording…" : "Reject"} />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Link
        href={`/inbox?conversation=${encodeURIComponent(review.conversationId)}`}
        className="text-primary press-text text-sm hover:underline"
      >
        Open the conversation in the Inbox →
      </Link>

      {confirmDeleteModal}
    </div>
  );
}
