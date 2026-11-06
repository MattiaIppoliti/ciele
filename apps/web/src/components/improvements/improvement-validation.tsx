"use client";

import { useEffect, useState, useTransition } from "react";
import { Button, Input } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import {
  listImprovementValidationsAction,
  recordImprovementValidationAction,
  requestImprovementReplayAction,
} from "@/app/actions";
import { formatDateTime } from "@/lib/format";
import { memberDisplayName } from "@/lib/members";
import { toast } from "@/lib/toast";

type View = Awaited<ReturnType<typeof listImprovementValidationsAction>>;

const STATUS_LABEL = { pending: "Pending", pass: "Pass", fail: "Fail", error: "Error" } as const;

/**
 * Validation evidence for one Improvement (docs/design/answer-improvement-
 * workflow.md): the append-only history, a Member's own widget check, and an
 * opt-in synthetic replay. Nothing here moves the status; that stays the
 * Member's call through the primary action or the status picker.
 */
export function ImprovementValidationPanel({
  improvementId,
  assistantId,
  question,
  canEdit,
  members,
}: {
  improvementId: string;
  /** The Assistant of the evidence on screen; null when no answer is linked. */
  assistantId: string | null;
  /** The Visitor question before the flagged answer, to seed a replay. */
  question: string;
  canEdit: boolean;
  members: { userId: string; email: string }[];
}) {
  const [view, setView] = useState<View | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [changedResources, setChangedResources] = useState("");
  const [detail, setDetail] = useState("");
  const [testQuestion, setTestQuestion] = useState(question);
  const [fragment, setFragment] = useState("");
  const [mustCiteSources, setMustCiteSources] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    listImprovementValidationsAction(improvementId)
      .then((data) => {
        if (live) setView(data);
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [improvementId]);

  function refresh() {
    startTransition(async () => {
      try {
        setView(await listImprovementValidationsAction(improvementId));
        setLoadFailed(false);
      } catch {
        setLoadFailed(true);
      }
    });
  }

  function record(result: "pass" | "fail") {
    if (!assistantId) return;
    startTransition(async () => {
      try {
        await recordImprovementValidationAction({
          improvementId,
          assistantId,
          expectedBehavior,
          changedResources,
          detail,
          result,
        });
        setView(await listImprovementValidationsAction(improvementId));
        setDetail("");
        toast.success("Widget check recorded");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not record the check");
      }
    });
  }

  function replay() {
    if (!assistantId) return;
    startTransition(async () => {
      try {
        await requestImprovementReplayAction({
          improvementId,
          assistantId,
          expectedBehavior,
          changedResources,
          cases: [{ question: testQuestion, expectations: { mustContain: [fragment], mustCiteSources } }],
        });
        setView(await listImprovementValidationsAction(improvementId));
        toast.success("Replay queued. Refresh to read the result.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not request a replay");
      }
    });
  }

  const validatorName = (userId: string | null) =>
    userId
      ? memberDisplayName(members.find((m) => m.userId === userId)?.email ?? null)
      : "A former Member";
  const ready =
    !!assistantId &&
    !!expectedBehavior.trim() &&
    !!changedResources.trim() &&
    !pending &&
    view?.available === true;
  const replayPending = view?.records.some((run) => run.status === "pending") ?? false;

  return (
    <section className="space-y-3 border-t pt-5" aria-label="Validation evidence">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Validation evidence</h2>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={pending}>
          Refresh
        </Button>
      </div>
      {loadFailed && (
        <p role="alert" className="text-sm">
          Could not load validation evidence. Use Refresh to retry.
        </p>
      )}
      {!view && !loadFailed && (
        <p role="status" className="text-muted-foreground text-sm">
          Loading validation evidence…
        </p>
      )}
      {view?.available === false && (
        <p className="text-muted-foreground text-sm">
          Validation recording is unavailable until the database upgrade completes.
        </p>
      )}
      {view?.available && view.records.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No recorded check. A Resolved status or finished Tasks do not prove the customer answer
          was checked.
        </p>
      )}
      {view?.records.map((run, index) => (
        <RollRow key={run.id} index={index}>
        <article className="space-y-1 rounded-lg border p-3 text-sm">
          <p className="font-medium">
            {run.kind === "manual" ? "Member widget check" : "Synthetic replay"}:{" "}
            <RollInText text={`${STATUS_LABEL[run.status]}${run.stale ? " · Stale" : ""}`} />
          </p>
          <p className="text-muted-foreground text-xs">
            {formatDateTime(run.completedAt ?? run.createdAt)} ·{" "}
            {run.publicationId ? `Publication ${run.publicationId}` : "Not published"} ·{" "}
            {validatorName(run.validatorId)}
          </p>
          <p className="whitespace-pre-wrap">Expected: {run.expectedBehavior}</p>
          <p className="whitespace-pre-wrap">Changed: {run.changedResources}</p>
          <p className="whitespace-pre-wrap">{run.detail}</p>
          {run.stale && (
            <p className="text-muted-foreground text-xs">
              The Publication or live knowledge changed since this check. Record a new check
              against the current version.
            </p>
          )}
          {run.results.map((result, index) => (
            <details key={index}>
              <summary className="press-text cursor-pointer">
                {result.pass ? "Pass" : "Fail"}: {result.question}
              </summary>
              <p className="whitespace-pre-wrap">{result.answer}</p>
              <p>{result.detail}</p>
            </details>
          ))}
        </article>
        </RollRow>
      ))}
      {canEdit && view?.available && (
        <fieldset className="space-y-3" disabled={pending || !assistantId}>
          <legend className="mb-2 text-sm font-medium">
            Check the Assistant for the evidence shown below
          </legend>
          {!assistantId && (
            <p className="text-muted-foreground text-sm">
              Link an answer from the Inbox to record a check against its Assistant.
            </p>
          )}
          <label className="block space-y-1 text-sm">
            <span>Expected answer or behavior</span>
            <Textarea
              value={expectedBehavior}
              onChange={(event) => setExpectedBehavior(event.target.value)}
              maxLength={5000}
              rows={2}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Changed Sources, Flows or instructions</span>
            <Textarea
              value={changedResources}
              onChange={(event) => setChangedResources(event.target.value)}
              maxLength={5000}
              rows={2}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Customer widget check: URL, steps and observed result</span>
            <Textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              maxLength={5000}
              rows={2}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!ready || !detail.trim()} onClick={() => record("pass")}>
              Record widget pass
            </Button>
            <Button variant="outline" size="sm" disabled={!ready || !detail.trim()} onClick={() => record("fail")}>
              Record widget failure
            </Button>
          </div>
          <details className="border-t pt-3">
            <summary className="press-text cursor-pointer text-sm font-medium">
              Replay a representative question
            </summary>
            <div className="mt-3 space-y-3">
              <p className="text-muted-foreground text-xs">
                Uses AI credits under the Organization&apos;s spend limits. Tests the latest
                Publication with live knowledge, for answer-only Assistants. A replay does not
                check the host website and does not resolve this item.
              </p>
              <label className="block space-y-1 text-sm">
                <span>Original question</span>
                <Input value={testQuestion} onChange={(event) => setTestQuestion(event.target.value)} maxLength={2000} />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Required text in the answer</span>
                <Input value={fragment} onChange={(event) => setFragment(event.target.value)} maxLength={300} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={mustCiteSources}
                  onCheckedChange={(checked) => setMustCiteSources(Boolean(checked))}
                />
                Require Source citations
              </label>
              <Button
                variant="outline"
                size="sm"
                disabled={!ready || !testQuestion.trim() || !fragment.trim() || replayPending}
                onClick={replay}
              >
                Run replay (uses AI credits)
              </Button>
            </div>
          </details>
        </fieldset>
      )}
    </section>
  );
}
