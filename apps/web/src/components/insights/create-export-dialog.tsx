"use client";

import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import type { ExportJobFormat, ExportJobKind, InsightsFilter } from "@agent-hub/core";
import {
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
          <SelectValue>{(v: string) => options.find((o) => o.value === v)?.label ?? v}</SelectValue>
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
}: {
  assistants: AssistantOption[];
  defaultFilter: InsightsFilter;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [filter, setFilter] = useState(defaultFilter);
  const [kind, setKind] = useState<ExportJobKind>("insights_overview");
  const [format, setFormat] = useState<ExportJobFormat>("csv");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function reset() {
    setName("");
    setFilter(defaultFilter);
    setKind("insights_overview");
    setFormat("csv");
    setError("");
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button className="ml-auto h-10 rounded-lg px-4" />}>
        <Download className="size-4" /> New export
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle className="text-lg">Create export</DialogTitle>
            <DialogDescription>Exports build in the background and appear in the list when ready.</DialogDescription>
          </DialogHeader>

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
              <p id="export-name-error" className="text-destructive text-xs">
                {error}
              </p>
            )}
          </div>

          <fieldset className="grid gap-3">
            <legend className="text-muted-foreground mb-2 text-sm">These filters will be applied in your report:</legend>
            <div className="flex flex-wrap gap-2">
              <DateRangeDropdown
                from={filter.from}
                to={filter.to}
                onChange={(from, to) => setFilter({ ...filter, from, to })}
              />
              <AssistantFilterDropdown
                assistants={assistants}
                value={filter.assistantId}
                onChange={(assistantId) => setFilter({ ...filter, assistantId, channel: "" })}
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
                onChange={(aggregate) => setFilter({ ...filter, aggregate: aggregate as InsightsFilter["aggregate"] })}
              />
              <Choice
                label="Feedback"
                value={filter.feedback}
                options={[
                  { value: "", label: "All feedback" },
                  { value: "up", label: "Positive" },
                  { value: "down", label: "Negative" },
                ]}
                onChange={(feedback) => setFilter({ ...filter, feedback: feedback as InsightsFilter["feedback"] })}
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
                  setFilter({ ...filter, escalation: escalation as InsightsFilter["escalation"] })
                }
              />
            </div>
          </fieldset>

          <div className="grid gap-2">
            <span className="text-sm font-medium">Select export type</span>
            <RadioGroup
              aria-label="Export type"
              value={kind}
              onValueChange={(value) => setKind(value as ExportJobKind)}
              options={KIND_OPTIONS}
            />
          </div>

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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
