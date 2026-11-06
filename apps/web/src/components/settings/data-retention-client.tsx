"use client";

import { useState, useTransition } from "react";
import {
  ClipboardList,
  Clock,
  Lightbulb,
  MessageSquareText,
  MessagesSquare,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Organization, RetentionDataType, RetentionUnit } from "@agent-hub/core";
import { Badge, Button } from "@agent-hub/ui";
import { updateOrganizationAction } from "@/app/actions";
import { RollInText } from "@/components/motion/roll-in-text";
import { useSettingsDirty } from "@/components/settings/settings-dirty";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  describeDays,
  initialRetentionState,
  isRowDirty,
  RETENTION_ROWS,
  retentionSubmission,
  rowError,
  type RetentionFormState,
  type RetentionRowSpec,
} from "@/lib/settings/data-retention";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const ICONS: Record<RetentionDataType, LucideIcon> = {
  conversations: MessagesSquare,
  messages: MessageSquareText,
  improvements: Lightbulb,
  audit: ClipboardList,
};

const UNITS: Array<{ value: RetentionUnit; label: string }> = [
  { value: "days", label: "Days" },
  { value: "months", label: "Months" },
  { value: "years", label: "Years" },
];

/**
 * Settings > Data retention: one window per data type, each with an
 * auto-delete switch (audit records are always on). The nightly sweep in
 * `/api/cron/sweep-retention` enforces what is saved here.
 */
export function DataRetentionClient({
  organization,
  demo,
}: {
  organization: Organization;
  demo: boolean;
}) {
  const [state, setState] = useState<RetentionFormState>(() =>
    initialRetentionState(organization)
  );
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const dirty = RETENTION_ROWS.some((spec) =>
    isRowDirty(organization, spec, state[spec.type])
  );
  useSettingsDirty(dirty);
  const submission = retentionSubmission(organization, state);

  function update(type: RetentionDataType, patch: Partial<RetentionFormState[RetentionDataType]>) {
    setState((current) => ({ ...current, [type]: { ...current[type], ...patch } }));
  }

  function save() {
    if (!submission) return;
    const run = () =>
      startTransition(async () => {
        try {
          await updateOrganizationAction(submission.patch);
          toast.success("Retention policy saved");
        } catch (error) {
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : "Could not save the retention policy"
          );
        }
      });
    if (submission.deletes.length === 0) {
      run();
      return;
    }
    const losses = submission.deletes.map(
      (item) => `${item.noun} older than ${describeDays(item.days)}`
    );
    confirmDelete({
      title: "Delete older data?",
      description: `The next nightly cleanup permanently deletes ${joinList(losses)}. Conversations under a legal hold are kept.`,
      confirmLabel: "Save and delete",
      onConfirm: run,
    });
  }

  return (
    <div className="space-y-6 pt-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {demo ? (
          <Badge variant="secondary" className="text-muted-foreground">
            Demo mode, changes only last for this session
          </Badge>
        ) : (
          <span />
        )}
        <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
          <Clock className="size-3.5" aria-hidden />
          Runs nightly
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div
          role="row"
          className="text-muted-foreground bg-muted/40 hidden grid-cols-[minmax(0,1fr)_15rem_9rem] gap-4 border-b px-4 py-3 text-xs font-semibold tracking-wide uppercase sm:grid"
        >
          <span role="columnheader">Data type</span>
          <span role="columnheader">Keep for</span>
          <span role="columnheader">Auto-delete</span>
        </div>
        <div className="divide-y">
          {RETENTION_ROWS.map((spec) => (
            <RetentionRow
              key={spec.type}
              spec={spec}
              row={state[spec.type]}
              dirty={isRowDirty(organization, spec, state[spec.type])}
              onChange={(patch) => update(spec.type, patch)}
            />
          ))}
        </div>
      </div>

      <HowItWorks />

      <div className="bg-content/95 sticky bottom-0 -mx-2 flex items-center justify-end gap-3 border-t px-2 py-4 backdrop-blur">
        <span role="status" aria-live="polite" className="text-muted-foreground mr-auto text-sm">
          {dirty && <RollInText text="Unsaved changes" />}
        </span>
        <Button
          variant="ghost"
          disabled={!dirty || isPending}
          onClick={() => setState(initialRetentionState(organization))}
        >
          Cancel
        </Button>
        <Button
          onClick={save}
          disabled={isPending || !dirty || !submission}
          className="px-6 font-semibold"
        >
          <RollInText text={isPending ? "Saving…" : "Save changes"} />
        </Button>
      </div>
      {confirmDeleteModal}
    </div>
  );
}

function RetentionRow({
  spec,
  row,
  dirty,
  onChange,
}: {
  spec: RetentionRowSpec;
  row: RetentionFormState[RetentionDataType];
  dirty: boolean;
  onChange: (patch: Partial<RetentionFormState[RetentionDataType]>) => void;
}) {
  const Icon = ICONS[spec.type];
  const error = rowError(row);
  const amountId = `retention-${spec.type}-amount`;
  const errorId = `retention-${spec.type}-error`;
  return (
    <div className="px-4 py-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_15rem_9rem] sm:items-start">
        <div className="flex min-w-0 gap-3">
          <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold">
              {spec.title}
              {dirty && (
                <span
                  className="size-2 rounded-full bg-orange-600"
                  aria-label="Changed, not saved"
                  role="img"
                />
              )}
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">{spec.description}</p>
          </div>
        </div>

        <div>
          <div className="flex gap-2">
            <input
              id={amountId}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={row.amount}
              disabled={!row.enabled}
              aria-label={`${spec.title}: keep for`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => onChange({ amount: event.target.value })}
              className={cn(
                "bg-background h-10 w-20 rounded-lg border px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
                error && "border-destructive text-destructive"
              )}
            />
            <Select
              value={row.unit}
              disabled={!row.enabled}
              onValueChange={(value) => onChange({ unit: (value as RetentionUnit) ?? row.unit })}
            >
              <SelectTrigger
                className="h-10 min-w-0 flex-1"
                aria-label={`${spec.title}: unit`}
              >
                <SelectValue>
                  {(value: string) => UNITS.find((unit) => unit.value === value)?.label ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((unit) => (
                  <SelectItem key={unit.value} value={unit.value}>
                    {unit.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!row.enabled && (
            <p className="text-muted-foreground mt-1.5 text-xs">Kept indefinitely.</p>
          )}
        </div>

        <div>
          {spec.alwaysOn ? (
            <p className="text-sm font-semibold">Always on</p>
          ) : (
            <Switch
              checked={row.enabled}
              onCheckedChange={(enabled) => onChange({ enabled })}
              aria-label={`Auto-delete ${spec.noun}`}
            />
          )}
          {row.enabled && (
            <p className="text-muted-foreground mt-1.5 text-xs">{spec.enabledHint}</p>
          )}
        </div>
      </div>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive mt-3 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium"
        >
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="space-y-2 text-sm">
      <h2 className="text-base font-semibold">How it works</h2>
      <ul className="text-muted-foreground list-disc space-y-1.5 pl-5">
        <li>
          A conversation&apos;s period counts from its last message, not from when it
          started. With a 30-day period, a conversation started 3 months ago whose last
          message was 10 days ago is kept until 30 days after that last message.
        </li>
        <li>Deleting a conversation also deletes its messages.</li>
        <li>
          Deleting messages removes old messages from conversations that stay. The
          transcript shows that earlier messages were deleted.
        </li>
        <li>
          Improvements are deleted when they have not been updated within their period,
          whatever their status. Deleting messages leaves linked improvements in place,
          without those messages.
        </li>
        <li>
          Conversations under a legal hold are never deleted, and neither are their
          messages.
        </li>
        <li>
          Deletion is permanent. Deleted data no longer appears anywhere in Ciele: the
          inbox, insights, exports, chat history and improvements. The audit log never
          records message or conversation content. It cannot be recovered.
        </li>
        <li>Audit records are always deleted once past their period.</li>
        <li>
          Turning a switch off stops future deletions. It does not restore anything
          already deleted.
        </li>
      </ul>
    </section>
  );
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
