"use client";

import { EmptyState } from "@/components/ui/empty-state";

import { useState, useSyncExternalStore, useTransition } from "react";
import type { RoutineCadence, TeammateRoutine } from "@agent-hub/core";
import { ROUTINE_CADENCES, TEAMMATE_ROUTINE_CAP } from "@agent-hub/core";
import { Button, Input, Label } from "@agent-hub/ui";
import { Plus, Trash2 } from "lucide-react";
import { AlertTriangle, Pause, Play } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import {
  CADENCE_LABELS,
  ROUTINES_EMPTY_HINT,
  capReason,
  scheduleLine,
  statusLine,
} from "@/lib/teammates/routine-copy";
import {
  createRoutineAction,
  deleteRoutineAction,
  updateRoutineAction,
} from "@/app/(admin)/teammates/actions";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { onRadioKeyDown } from "@/lib/radio-keys";

const NOOP_SUBSCRIBE = () => () => {};
/** The current minute: stable between renders, so the store never loops. */
const currentMinute = () => Math.floor(Date.now() / 60_000);
/** The server has no "now" worth rendering relative times from. */
const noMinute = () => null;

/**
 * Standing instructions this Teammate carries out on its own (#772).
 *
 * Editable by whoever may edit the Teammate, which is the same rule the
 * operations enforce: giving an agent something to do while nobody is watching
 * is not a different kind of decision from configuring what it is.
 *
 * Every row leads with its schedule and its last outcome, because those are
 * the two things somebody opens this panel to check. Copy lives in
 * `lib/teammates/routine-copy.ts`, where it is tested.
 */
export function RoutinesPanel({
  routines,
  teammateId,
  canEdit,
}: {
  routines: TeammateRoutine[];
  teammateId: string;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [cadence, setCadence] = useState<RoutineCadence>("daily");
  const [hour, setHour] = useState(8);
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  // One moment for every row, read only after hydration: the server's clock and
  // the browser's disagree, and "in 3 hours" rendered on both is a hydration
  // mismatch waiting for a slow response. The first paint holds the line empty.
  const minute = useSyncExternalStore(NOOP_SUBSCRIBE, currentMinute, noMinute);
  const now = minute === null ? null : new Date(minute * 60_000);
  const blocked = capReason(routines.length, TEAMMATE_ROUTINE_CAP);

  function run(work: () => Promise<unknown>, done: string) {
    startTransition(async () => {
      try {
        await work();
        toast.success(done);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Something went wrong"
        );
      }
    });
  }

  return (
    <div className="space-y-3">
      {confirmDeleteModal}
      <div className="flex items-center justify-between">
        <Label>Routines</Label>
        {canEdit && !blocked && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding((open) => !open)}
          >
            <Plus className="size-4" /> Add
          </Button>
        )}
      </div>

      {routines.length === 0 && !adding && (
        <EmptyState size="sm" title="No routines yet" description={ROUTINES_EMPTY_HINT} action={canEdit ? <Button variant="outline" size="sm" onClick={() => setAdding(true)}>Add routine</Button> : undefined} />
      )}

      {routines.map((routine) => (
        <div
          key={routine.id}
          className="flex items-start gap-3 rounded-lg border px-3 py-2.5"
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-sm font-medium">{routine.instruction}</p>
            <p className="text-muted-foreground text-xs">
              {scheduleLine(routine)}
            </p>
            <p
              className={`flex items-center gap-1 text-xs ${
                routine.lastStatus === "failed" && routine.enabled
                  ? "text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {routine.lastStatus === "failed" && routine.enabled && (
                <AlertTriangle className="size-3 shrink-0" />
              )}
              {now !== null ||
              !routine.enabled ||
              routine.lastStatus === "failed" ? (
                // Paused and failed read no clock, so they need not wait.
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {statusLine(routine, now ?? new Date(0))}
                </span>
              ) : (
                <span aria-hidden="true">&nbsp;</span>
              )}
            </p>
          </div>
          {canEdit && (
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                title={routine.enabled ? "Pause" : "Resume"}
                aria-label={routine.enabled ? "Pause routine" : "Resume routine"}
                onClick={() =>
                  run(
                    () =>
                      updateRoutineAction(routine.id, {
                        enabled: !routine.enabled,
                      }),
                    routine.enabled ? "Paused" : "Resumed"
                  )
                }
              >
                {routine.enabled ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={isPending}
                aria-label="Delete routine"
                onClick={() =>
                  confirmDelete({
                    title: "Delete this routine?",
                    description: "The Teammate stops running it. This cannot be undone.",
                    confirmLabel: "Delete routine",
                    onConfirm: () =>
                      run(() => deleteRoutineAction(routine.id), "Routine deleted"),
                  })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          )}
        </div>
      ))}

      {blocked && canEdit && (
        <p className="text-muted-foreground text-sm">{blocked}</p>
      )}

      {adding && canEdit && (
        <div className="space-y-3 rounded-lg border p-3">
          <Textarea
            value={instruction}
            rows={3}
            placeholder="Every morning, triage yesterday's negative feedback and file what is new."
            aria-label="Routine instruction"
            onChange={(e) => setInstruction(e.target.value.slice(0, 2000))}
          />
          <div className="flex flex-wrap items-end gap-2">
            <div role="radiogroup" aria-label="How often" className="flex gap-2">
              {ROUTINE_CADENCES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  onClick={() => setCadence(option)}
                  aria-checked={cadence === option}
                  tabIndex={cadence === option ? 0 : -1}
                  onKeyDown={onRadioKeyDown}
                  data-foley-toggle="switch"
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    cadence === option
                      ? "border-primary ring-primary/30 ring-1"
                      : "hover:bg-muted/50"
                  }`}
                >
                  {CADENCE_LABELS[option]}
                </button>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="routine-hour" className="text-xs">
                Hour (UTC)
              </Label>
              <Input
                id="routine-hour"
                type="number"
                min={0}
                max={23}
                value={hour}
                className="w-24"
                onChange={(e) =>
                  setHour(Math.min(23, Math.max(0, Number(e.target.value) || 0)))
                }
              />
            </div>
            <Button
              className="ml-auto"
              disabled={!instruction.trim() || isPending}
              onClick={() =>
                run(async () => {
                  await createRoutineAction({
                    teammateId,
                    instruction: instruction.trim(),
                    cadence,
                    hour,
                  });
                  setInstruction("");
                  setAdding(false);
                }, "Routine added")
              }
            >
              Add routine
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
