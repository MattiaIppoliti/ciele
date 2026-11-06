"use client";

import { RollInText, RollRow } from "@/components/motion/roll-in-text";

import { useState, useTransition } from "react";
import { useBrowserTimezone, localExportHour } from "@/lib/hooks/use-browser-timezone";
import { Download } from "lucide-react";
import type { ExportJobFormat, ExportJobKind, InsightsFilter } from "@agent-hub/core";
import { DialogBody, DialogSection,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from "@agent-hub/ui";
import { createExportScheduleAction } from "@/app/(admin)/insights/exports/schedule-actions";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { requestInsightsExportAction } from "@/app/(admin)/insights/exports/actions";
import { AssistantFilterDropdown } from "@/components/insights/assistant-filter-dropdown";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { RadioGroup } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";

interface AssistantOption {
  id: string;
  title: string;
}

const KIND_OPTIONS: Array<{ value: ExportJobKind | "shortcut_clicks"; label: string; hint: string; disabled?: boolean }> = [
  { value: "insights_overview", label: "Aggregated insights", hint: "Every chart series, one row per day, week or month." },
  { value: "insights_datapoints", label: "Datapoints", hint: "The headline measures for the range, one row each." },
  { value: "insights_languages", label: "Languages", hint: "Conversations per language the Visitor wrote in." },
  // Offered so the choice is visible, and disabled because nothing records a
  // shortcut click yet: the export would be a file of zeros.
  { value: "shortcut_clicks", label: "Shortcut button clicks", hint: "Not recorded yet.", disabled: true },
];

const FORMAT_OPTIONS: Array<{ value: ExportJobFormat; label: string }> = [
  { value: "csv", label: "CSV" },
  { value: "json", label: "JSON" },
  { value: "xlsx", label: "XLSX" },
];

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v as string)}>
        <SelectTrigger>
          <SelectValue>{(v: string) => <RollInText text={options.find((o) => o.value === v)?.label ?? v} />}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Create export: a name, the filters the report is built with, what it
 * contains and the file type. The filters are the Insights overview's, so an
 * export matches the page for the same choices.
 */
export function CreateExportDialog({
  assistants,
  defaultFilter,
  scheduleMembers,
  onScheduled,
}: {
  assistants: AssistantOption[];
  defaultFilter: InsightsFilter;
  scheduleMembers?: Array<{ userId: string; email: string }>;
  onScheduled?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState(defaultFilter);
  const [kind, setKind] = useState<Exclude<ExportJobKind, "audit_log">>("insights_overview");
  const [format, setFormat] = useState<ExportJobFormat>("csv");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [cadence, setCadence] = useState("weekly");
  const [weekday, setWeekday] = useState(1);
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(8);
  const [recipientMemberIds, setRecipientMemberIds] = useState<string[]>([]);
  const timezone = useBrowserTimezone();
  const localHour = localExportHour(hour, timezone);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const dirty = open && (Boolean(name) || JSON.stringify(filter) !== JSON.stringify(defaultFilter) || kind !== "insights_overview" || format !== "csv" || cadence !== "weekly" || weekday !== 1 || day !== 1 || hour !== 8 || recipientMemberIds.length > 0);
  const { leave } = useUnsavedChanges({ dirty, saving: pending, confirmDelete });
  const close = () => { if (!pending) leave(() => { setOpen(false); reset(); }); };

  function reset() {
    setName("");
    setFilter(defaultFilter);
    setKind("insights_overview");
    setFormat("csv");
    setError("");
    setCadence("weekly"); setWeekday(1); setDay(1); setHour(8); setRecipientMemberIds([]);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Give the export a name");
      return;
    }
    const filters = Object.fromEntries(
      Object.entries(filter).filter(([, value]) => value !== "")
    ) as Record<string, string>;
    startTransition(async () => {
      if (scheduleMembers) {
        const result = await createExportScheduleAction({ name, kind, format, filters, hour, recipientMemberIds, cadence: cadence === "weekly" ? { kind: "weekly", weekday } : { kind: "monthly", day } });
        if (!result.ok) { setError(result.error); return; }
        toast.success("Export schedule saved"); setOpen(false); reset(); onScheduled?.(); return;
      }
      const result = await requestInsightsExportAction({ name, kind, format, filters });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Export queued. It appears in the list when it is ready.");
      setOpen(false);
      reset();
    });
  }

  return (
    <><Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true); else close();
      }}
    >
      <DialogTrigger render={<Button className="h-8 rounded-lg px-3" />}>
        <Download className="size-4" /><RollInText text={scheduleMembers ? "Schedule" : "New export"} />
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle className="text-lg"><RollInText text={scheduleMembers ? "Schedule export" : "Create export"} /></DialogTitle>
            <DialogDescription>{scheduleMembers ? "Each run creates a private export and emails the selected Members a sign-in link." : "Runs in the background."}</DialogDescription>
          </DialogHeader>

          <DialogBody>
            <DialogSection>
              <div className="grid gap-1.5">
                <Label htmlFor="export-name">
                  Export name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="export-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (error) setError("");
                  }}
                  placeholder="Enter your export name"
                  autoComplete="off"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "export-name-error" : undefined}
                />
                {error && (
                  <p
                    id="export-name-error"
                    className="text-destructive text-xs"
                  >
                    {error}
                  </p>
                )}
              </div>
            </DialogSection>

            <DialogSection>
              <fieldset className="grid gap-3">
                <legend className="text-muted-foreground mb-2 text-sm">
                  These filters will be applied in your report:
                </legend>
                <div className="flex flex-wrap gap-2">
                  {!scheduleMembers && <DateRangeDropdown
                    from={filter.from}
                    to={filter.to}
                    onChange={(from, to) => setFilter({ ...filter, from, to })}
                  />}
                  <AssistantFilterDropdown
                    assistants={assistants}
                    value={filter.assistantId}
                    onChange={(assistantId) =>
                      setFilter({ ...filter, assistantId, channel: "" })
                    }
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Choice
                    label="Aggregated"
                    value={filter.aggregate}
                    options={[
                      { value: "daily", label: "Daily" },
                      { value: "weekly", label: "Weekly" },
                      { value: "monthly", label: "Monthly" },
                    ]}
                    onChange={(aggregate) =>
                      setFilter({
                        ...filter,
                        aggregate: aggregate as InsightsFilter["aggregate"],
                      })
                    }
                  />
                  <Choice
                    label="Feedback"
                    value={filter.feedback}
                    options={[
                      { value: "", label: "All feedback" },
                      { value: "up", label: "Positive" },
                      { value: "down", label: "Negative" },
                    ]}
                    onChange={(feedback) =>
                      setFilter({
                        ...filter,
                        feedback: feedback as InsightsFilter["feedback"],
                      })
                    }
                  />
                  <Choice
                    label="Escalated"
                    value={filter.escalation}
                    options={[
                      { value: "", label: "All escalations" },
                      { value: "escalated", label: "Escalated" },
                      { value: "not_escalated", label: "Not escalated" },
                    ]}
                    onChange={(escalation) =>
                      setFilter({
                        ...filter,
                        escalation: escalation as InsightsFilter["escalation"],
                      })
                    }
                  />
                </div>
              </fieldset>
            </DialogSection>

            {scheduleMembers && <DialogSection>
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice label="Cadence" value={cadence} options={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} onChange={setCadence} />
                {cadence === "weekly" ? <Choice label="Weekday (UTC)" value={String(weekday)} options={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, index) => ({ value: String(index), label }))} onChange={value => setWeekday(Number(value))} /> : <label className="grid gap-1 text-sm">Day of month (UTC)<Input type="number" min={1} max={31} value={day} onChange={event => setDay(Number(event.target.value))} /></label>}
                <label className="grid gap-1 text-sm">Hour (UTC)<Input type="number" min={0} max={23} value={hour} onChange={event => setHour(Number(event.target.value))} /></label>
                <p className="text-muted-foreground self-end text-sm"><RollInText text={localHour ? `Your local time: ${localHour}` : "Loading your local time…"} /></p>
              </div>
              <p className="text-muted-foreground mt-3 text-xs">{cadence === "weekly" ? "Each report covers the last 7 closed UTC days." : "Each report covers the previous calendar month. Days beyond a month's end use its last day."}</p>
              <p className="mt-4 text-sm font-medium">Email Members</p>
              <div className="mt-2 grid gap-2">{scheduleMembers.map((member, index) => <RollRow key={member.userId} index={index}><label className="flex items-center gap-2 text-sm"><Checkbox checked={recipientMemberIds.includes(member.userId)} onCheckedChange={checked => setRecipientMemberIds(ids => checked === true ? [...ids, member.userId] : ids.filter(id => id !== member.userId))} /><RollInText text={member.email} /></label></RollRow>)}</div>
            </DialogSection>}

            <DialogSection>
              <div className="grid gap-2">
                <span className="text-sm font-medium">Select export type</span>
                <RadioGroup
                  aria-label="Export type"
                  value={kind}
                  onValueChange={(value) => setKind(value as Exclude<ExportJobKind, "audit_log">)}
                  options={KIND_OPTIONS}
                />
              </div>
            </DialogSection>

            <DialogSection>
              <div className="grid gap-2">
                <span className="text-sm font-medium">Select file type</span>
                <RadioGroup
                  aria-label="File type"
                  value={format}
                  onValueChange={(value) => setFormat(value as ExportJobFormat)}
                  options={FORMAT_OPTIONS}
                  className="flex flex-wrap gap-6"
                />
              </div>
            </DialogSection>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={close}
            >
              Cancel
            </Button>
            <Button loading={pending} type="submit" disabled={pending}>
              <RollInText text={pending ? "Creating…" : "Create"} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>{confirmDeleteModal}</>
  );
}
