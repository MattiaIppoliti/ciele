"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { AssistantGoal, GoalExpectations } from "@agent-hub/core";
import {
  createGoalAction,
  deleteGoalAction,
  updateGoalAction,
} from "@/app/actions";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";

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
  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <div className="grid gap-1.5">
        <Label>Question</Label>
        <Textarea
          rows={2}
          placeholder="e.g. What does shipping cost?"
          value={draft.question}
          onChange={(e) => setDraft({ ...draft, question: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Cited Source URL must contain (optional)</Label>
          <Input
            placeholder="e.g. /shipping"
            value={draft.expectedSourceUrl}
            onChange={(e) =>
              setDraft({ ...draft, expectedSourceUrl: e.target.value })
            }
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Answer must contain (comma-separated, optional)</Label>
          <Input
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
      <p className="text-muted-foreground text-xs">
        “The answer is not the ‘couldn&apos;t find an answer’ fallback” is
        always checked.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={saving || !draft.question.trim()}>
          {saving ? "Saving…" : saveLabel}
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

  const run = (work: () => Promise<void>, ok: string) =>
    startTransition(async () => {
      try {
        await work();
        toast.success(ok);
        setAdding(false);
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Something went wrong");
      }
    });

  return (
    <div className="mt-6 grid gap-4">
      {goals.length === 0 && !adding && (
        <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
          No standing goals yet. Add the questions your business depends on —
          pricing, availability, policies — and they&apos;ll be re-verified on a
          schedule. A failing goal raises an Alert.
        </p>
      )}

      {goals.map((goal) =>
        editingId === goal.id ? (
          <GoalForm
            key={goal.id}
            draft={editDraft}
            setDraft={setEditDraft}
            saving={isPending}
            saveLabel="Save goal"
            onCancel={() => setEditingId(null)}
            onSave={() =>
              run(
                () =>
                  updateGoalAction(assistantId, goal.id, {
                    question: editDraft.question,
                    expectations: expectationsFromDraft(editDraft),
                  }),
                "Goal saved"
              )
            }
          />
        ) : (
          <div key={goal.id} className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{goal.question}</span>
                {goal.status === "quarantined" && (
                  <Badge variant="outline">Quarantined</Badge>
                )}
                {goal.lastResult === "pass" && <Badge>Passing</Badge>}
                {goal.lastResult === "fail" && (
                  <Badge variant="destructive">Failing</Badge>
                )}
                {goal.lastResult === null && (
                  <Badge variant="secondary">Not run yet</Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
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
                {goal.lastRunAt &&
                  ` · last run ${new Date(goal.lastRunAt).toLocaleString()}`}
                {goal.lastResult === "fail" && goal.lastDetail
                  ? ` · ${goal.lastDetail}`
                  : ""}
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
                  disabled={isPending}
                  onClick={() =>
                    run(
                      () =>
                        updateGoalAction(assistantId, goal.id, {
                          status:
                            goal.status === "active" ? "quarantined" : "active",
                        }),
                      goal.status === "active" ? "Goal quarantined" : "Goal reactivated"
                    )
                  }
                >
                  {goal.status === "active" ? "Quarantine" : "Reactivate"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={isPending}
                  onClick={() =>
                    run(() => deleteGoalAction(assistantId, goal.id), "Goal deleted")
                  }
                >
                  Delete
                </Button>
              </div>
            )}
          </div>
        )
      )}

      {canEdit &&
        (adding ? (
          <GoalForm
            draft={draft}
            setDraft={setDraft}
            saving={isPending}
            saveLabel="Add goal"
            onCancel={() => setAdding(false)}
            onSave={() =>
              run(
                () =>
                  createGoalAction(assistantId, {
                    question: draft.question,
                    expectations: expectationsFromDraft(draft),
                  }),
                "Goal added"
              )
            }
          />
        ) : (
          <div>
            <Button
              variant="outline"
              onClick={() => setAdding(true)}
              disabled={goals.length >= cap}
            >
              Add goal ({goals.length}/{cap})
            </Button>
          </div>
        ))}
    </div>
  );
}
