"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { useId, useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import type { AssistantGoal, GoalExpectations } from "@agent-hub/core";
import {
  createGoalAction,
  deleteGoalAction,
  updateGoalAction,
} from "@/app/actions";
import { Card } from "@agent-hub/ui";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { Button } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { formatCount, formatDateTime } from "@/lib/format";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { SlotPortal, TOP_BAR_SLOT } from "@/components/shell/slot-portal";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { Plus } from "lucide-react";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";

/**
 * Standing goals authoring (spec: scheduled golden-question checks). Admins
 * write the questions their business depends on plus deterministic
 * expectations; the scheduled runner re-verifies them and feeds Alerts.
 */

interface GoalDraft {
  question: string;
  mustCiteSources: boolean;
  expectedSourceUrl: string;
  mustContain: string;
}

const EMPTY_DRAFT: GoalDraft = {
  question: "",
  mustCiteSources: false,
  expectedSourceUrl: "",
  mustContain: "",
};

function draftFromGoal(goal: AssistantGoal): GoalDraft {
  return {
    question: goal.question,
    mustCiteSources: Boolean(goal.expectations.mustCiteSources),
    expectedSourceUrl: goal.expectations.expectedSourceUrl ?? "",
    mustContain: (goal.expectations.mustContain ?? []).join(", "),
  };
}

function expectationsFromDraft(draft: GoalDraft): GoalExpectations {
  return {
    mustCiteSources: draft.mustCiteSources,
    expectedSourceUrl: draft.expectedSourceUrl,
    mustContain: draft.mustContain.split(",").map((f) => f.trim()),
  };
}

function GoalForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  saving,
  saveLabel,
}: {
  draft: GoalDraft;
  setDraft: (d: GoalDraft) => void;
  onSave: () => void;
  onCancel?: () => void;
  saving: boolean;
  saveLabel: string;
}) {
  const id = useId();
  return (
    <div className="bg-background/40 grid gap-3 rounded-lg border p-4">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-question`}>Question</Label>
        <Textarea
          id={`${id}-question`}
          name="question"
          rows={2}
          placeholder="e.g. What does shipping cost?"
          value={draft.question}
          onChange={(e) => setDraft({ ...draft, question: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-source-url`}>Cited Source URL must contain (optional)</Label>
          <Input
            id={`${id}-source-url`}
            name="expectedSourceUrl"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. /shipping"
            value={draft.expectedSourceUrl}
            onChange={(e) =>
              setDraft({ ...draft, expectedSourceUrl: e.target.value })
            }
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-must-contain`}>Answer must contain (comma-separated, optional)</Label>
          <Input
            id={`${id}-must-contain`}
            name="mustContain"
            autoComplete="off"
            placeholder="e.g. free, 3-5 days"
            value={draft.mustContain}
            onChange={(e) => setDraft({ ...draft, mustContain: e.target.value })}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={draft.mustCiteSources}
          onCheckedChange={(v) =>
            setDraft({ ...draft, mustCiteSources: v === true })
          }
        />
        The answer must cite at least one Source
      </label>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={saving || !draft.question.trim()}>
          <RollInText text={saving ? "Saving…" : saveLabel} />
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export function GoalsClient({
  assistantId,
  goals,
  cap,
  canEdit,
}: {
  assistantId: string;
  goals: AssistantGoal[];
  cap: number;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<GoalDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<GoalDraft>(EMPTY_DRAFT);
  const [isPending, startTransition] = useTransition();
  // Which goal (or "new") the running transition belongs to, so quarantining
  // one goal does not disable every other goal's buttons.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const busy = (key: string) => isPending && pendingKey === key;
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const run = (
    key: string,
    work: () => Promise<void>,
    ok: string,
    onDone?: () => void
  ) => {
    setPendingKey(key);
    startTransition(async () => {
      try {
        await work();
        toast.success(ok);
        onDone?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Something went wrong");
      }
    });
  };

  const full = goals.length >= cap;

  return (
    <div className="pt-6 pb-24">
      <SectionTimeline>
        <TimelineSection title="Goals">
          <Card size="sm" className="gap-4 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">Questions your business depends on</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Each one is asked again on a schedule against the latest publish.{" "}
                  <span className="tabular-nums">
                    <RollingNumber value={goals.length} />/{formatCount(cap)}
                  </span>{" "}
                  used.
                </p>
              </div>
              {/* Add lives in the top bar, beside the breadcrumb, as the
                  page's committing action. */}
              {canEdit && !adding && (
                <SlotPortal id={TOP_BAR_SLOT}>
                  <Button
                    className="h-8 rounded-lg px-3 font-semibold"
                    disabled={full}
                    title={full ? `An Assistant can have ${formatCount(cap)} goals.` : undefined}
                    onClick={() => setAdding(true)}
                  >
                    <AnimatedIcon icon={Plus} size={16} /> Add goal
                  </Button>
                </SlotPortal>
              )}
            </div>

            {goals.length === 0 && !adding && (
              <EmptyState size="sm" title="No goals yet" description="Add the questions that matter most, like pricing or policies." action={canEdit ? <Button variant="outline" size="sm" disabled={full} onClick={() => setAdding(true)}>Add goal</Button> : undefined} />
            )}

            {goals.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {goals.map((goal) =>
                  editingId === goal.id ? (
                    <li key={goal.id} className="p-2">
                      <GoalForm
                        draft={editDraft}
                        setDraft={setEditDraft}
                        saving={busy(goal.id)}
                        saveLabel="Save goal"
                        onCancel={() => setEditingId(null)}
                        onSave={() =>
                          run(
                            goal.id,
                            () =>
                              updateGoalAction(assistantId, goal.id, {
                                question: editDraft.question,
                                expectations: expectationsFromDraft(editDraft),
                              }),
                            "Goal saved",
                            () => setEditingId(null)
                          )
                        }
                      />
                    </li>
                  ) : (
                    <li
                      key={goal.id}
                      className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 font-medium break-words">{goal.question}</span>
                          {goal.status === "quarantined" && <StatusPill status="warning" primaryText="Quarantined" />}
                          {goal.lastResult === "pass" && <StatusPill status="online" primaryText="Passing" />}
                          {goal.lastResult === "fail" && <StatusPill status="error" primaryText="Failing" />}
                          {goal.lastResult === null && <StatusPill status="offline" primaryText="Not run yet" />}
                        </div>
                        <p className="text-muted-foreground mt-0.5 text-xs break-words">
                          {[
                            goal.expectations.mustCiteSources ? "must cite a Source" : null,
                            goal.expectations.expectedSourceUrl
                              ? `Source URL contains “${goal.expectations.expectedSourceUrl}”`
                              : null,
                            goal.expectations.mustContain?.length
                              ? `answer contains: ${goal.expectations.mustContain.join(", ")}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "no extra expectations"}
                          {goal.lastRunAt && ` · last run ${formatDateTime(goal.lastRunAt)}`}
                          {goal.lastResult === "fail" && goal.lastDetail ? ` · ${goal.lastDetail}` : ""}
                        </p>
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(goal.id);
                              setEditDraft(draftFromGoal(goal));
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy(goal.id)}
                            onClick={() =>
                              run(
                                goal.id,
                                () =>
                                  updateGoalAction(assistantId, goal.id, {
                                    status: goal.status === "active" ? "quarantined" : "active",
                                  }),
                                goal.status === "active" ? "Goal quarantined" : "Goal reactivated"
                              )
                            }
                          >
                            <RollInText text={goal.status === "active" ? "Quarantine" : "Reactivate"} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={busy(goal.id)}
                            onClick={() =>
                              confirmDelete({
                                title: "Delete this goal?",
                                description: `“${goal.question}” stops being checked on its schedule.`,
                                onConfirm: async () => {
                                  await deleteGoalAction(assistantId, goal.id);
                                  toast.success("Goal deleted");
                                },
                              })
                            }
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                )}
              </ul>
            )}

            {canEdit && adding && (
              <GoalForm
                draft={draft}
                setDraft={setDraft}
                saving={busy("new")}
                saveLabel="Add goal"
                onCancel={() => setAdding(false)}
                onSave={() =>
                  run(
                    "new",
                    () =>
                      createGoalAction(assistantId, {
                        question: draft.question,
                        expectations: expectationsFromDraft(draft),
                      }),
                    "Goal added",
                    () => {
                      setAdding(false);
                      setDraft(EMPTY_DRAFT);
                    }
                  )
                }
              />
            )}
          </Card>
        </TimelineSection>

        <TimelineSection title="How goals are checked">
          <Card size="sm" className="gap-3 p-4">
            <h2 className="text-base font-semibold">Exact checks, no model grader</h2>
            <ul className="text-muted-foreground grid gap-1.5 text-sm">
              <li>Every run checks that the answer is not the &ldquo;couldn&apos;t find an answer&rdquo; fallback.</li>
              <li>The expectations you add on a goal are checked on top of that.</li>
              <li>A failing goal raises an Alert, which clears when the goal passes again.</li>
              <li>A goal that keeps failing to run is quarantined, never deleted. Reactivate it once it is fixed.</li>
            </ul>
          </Card>
        </TimelineSection>
      </SectionTimeline>
      {confirmDeleteModal}
    </div>
  );
}
