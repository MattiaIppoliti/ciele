"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bot,
  ChevronDown,
  Download,
  Eye,
  Filter,
  KeyRound,
  User,
  X,
} from "lucide-react";
import type { AuditActionTone, AuditLogEntry, Member } from "@agent-hub/core";
import { AUDIT_ACTIONS, AUDIT_SYSTEM_ACTOR, auditActionInfo } from "@agent-hub/core";
import { Button, Hint, Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import { exportAuditLogAction } from "@/app/(admin)/settings/audit-log/actions";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
import { DateRangeDropdown } from "@/components/insights/date-range-dropdown";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WorkspacePanel } from "@/components/ui/workspace-panel";
import {
  AUDIT_LOG_MAX_LIMIT,
  AUDIT_LOG_PAGE_SIZE,
  auditActorKind,
  auditLogFilter,
  auditLogQuery,
  formatAuditWhen,
  formatChangeValue,
  isFiltered,
  type AuditLogView,
} from "@/lib/settings/audit-log";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const TONE_DOT: Record<AuditActionTone, string> = {
  added: "bg-emerald-500",
  changed: "bg-blue-500",
  removed: "bg-red-500",
};

const ANY_ACTOR = "__any";

/** Names the page resolved for ids an entry carries: API keys and Teammates. */
export interface AuditNames {
  apiKeys: Record<string, string>;
  teammates: Record<string, string>;
}

/**
 * Settings > Audit log: filters over the URL, a table of entries, and a panel
 * with one entry's details and its before/after values.
 */
export function AuditLogClient({
  entries,
  view,
  members,
  names,
  links,
}: {
  entries: AuditLogEntry[];
  view: AuditLogView;
  members: Member[];
  names: AuditNames;
  links: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [exporting, startExport] = useTransition();
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  // The curated actions, plus any other operation already in view, so a
  // filter can always narrow to what the page shows.
  const actionOptions = [
    ...new Set([...Object.keys(AUDIT_ACTIONS), ...entries.map((entry) => entry.operation), ...view.actions]),
  ]
    .map((value) => ({ value, label: auditActionInfo(value).label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  function go(next: Partial<AuditLogView>) {
    // A filter change starts the list over at one page.
    const merged: AuditLogView = { ...view, limit: AUDIT_LOG_PAGE_SIZE, ...next };
    // Replace, not push: the Settings dialog is one history entry, and
    // filtering must not make closing it take several Back presses.
    startTransition(() => router.replace(`${pathname}${auditLogQuery(merged)}`, { scroll: false }));
  }

  function exportCsv() {
    startExport(async () => {
      const { operations, memberId, domain, from, to, order } = auditLogFilter(view);
      try {
        await exportAuditLogAction({ operations, memberId, domain, from, to, order });
        toast.success("Audit export queued");
        router.push("/insights/exports");
      } catch {
        toast.error("Could not queue the audit export");
      }
    });
  }

  const table = (
    <div className="space-y-4 pt-6 pb-16">
      <div className="flex flex-wrap items-center gap-2">
        <ActionFilter selected={view.actions} options={actionOptions} onChange={(actions) => go({ actions })} />
        <Select
          value={view.actor || ANY_ACTOR}
          onValueChange={(value) => go({ actor: value === ANY_ACTOR ? "" : String(value ?? "") })}
        >
          <SelectTrigger className="h-10 w-auto min-w-40 rounded-lg" aria-label="Filter by actor">
            <User className="size-4 shrink-0" aria-hidden />
            <SelectValue>
              {(value: string) =>
                value === ANY_ACTOR
                  ? "Filter by actor"
                  : value === AUDIT_SYSTEM_ACTOR
                    ? "System"
                    : (members.find((member) => member.userId === value)?.email ?? "Former member")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_ACTOR}>Any actor</SelectItem>
            <SelectItem value={AUDIT_SYSTEM_ACTOR}>System</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DateRangeDropdown from={view.from} to={view.to} onChange={(from, to) => go({ from, to })} />
        {isFiltered(view) && (
          <Button
            variant="ghost"
            className="h-10"
            onClick={() => go({ actions: [], actor: "", domain: "", from: "", to: "" })}
          >
            <X className="size-4" aria-hidden />
            Clear filters
          </Button>
        )}
        <Button variant="outline" className="ml-auto h-10" disabled={exporting} onClick={exportCsv}>
          <Download className="size-4" aria-hidden />
          <RollInText text={exporting ? "Queueing…" : "Export CSV"} />
        </Button>
      </div>

      <TableCard className={cn("transition-opacity", pending && "opacity-60")}>
        <Table empty={entries.length === 0}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">
                <button
                  type="button"
                  className="press-text inline-flex items-center gap-1"
                  onClick={() => go({ oldest: !view.oldest })}
                  aria-label={view.oldest ? "Sort newest first" : "Sort oldest first"}
                >
                  When
                  {view.oldest ? (
                    <ArrowUp className="size-3.5" aria-hidden />
                  ) : (
                    <ArrowDown className="size-3.5" aria-hidden />
                  )}
                </button>
              </TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-10 text-center">
                  {isFiltered(view)
                    ? "No entries match these filters."
                    : "Nothing recorded yet. Configuration changes from the console, the API, the CLI and the MCP server appear here."}
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry, index) => (
                <RollRow key={entry.id} index={index}>
                  <TableRow>
                    <TableCell className="text-sm whitespace-nowrap tabular-nums">
                      <RollInText text={formatAuditWhen(entry.createdAt)} />
                    </TableCell>
                    <TableCell>
                      <ActionLabel entry={entry} />
                    </TableCell>
                    <TableCell>
                      <Actor entry={entry} names={names} />
                    </TableCell>
                    <TableCell>
                      <Target entry={entry} />
                    </TableCell>
                    <TableCell>
                      <Hint label="View details">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`View details of ${auditActionInfo(entry.operation).label}`}
                          onClick={() => setSelected(entry)}
                        >
                          <Eye className="size-4" />
                        </Button>
                      </Hint>
                    </TableCell>
                  </TableRow>
                </RollRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      {entries.length >= view.limit && view.limit < AUDIT_LOG_MAX_LIMIT && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(() =>
                router.replace(
                  `${pathname}${auditLogQuery({ ...view, limit: Math.min(view.limit + AUDIT_LOG_PAGE_SIZE, AUDIT_LOG_MAX_LIMIT) })}`,
                  { scroll: false }
                )
              )
            }
          >
            Show more
          </Button>
        </div>
      )}
      {entries.length >= AUDIT_LOG_MAX_LIMIT && (
        <p className="text-muted-foreground text-center text-sm">
          The first {AUDIT_LOG_MAX_LIMIT} matches are shown. Export the CSV for every entry.
        </p>
      )}
    </div>
  );

  return (
    <WorkspacePanel
      open={selected !== null}
      onClose={() => setSelected(null)}
      label="Entry details"
      slot="audit-entry"
      widthKey="settings.audit-entry.width"
      detail={selected ? <EntryDetails entry={selected} names={names} links={links} /> : null}
    >
      {table}
    </WorkspacePanel>
  );
}

function ActionFilter({
  selected,
  options,
  onChange,
}: {
  selected: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (actions: string[]) => void;
}) {
  const chosen = new Set(selected);
  const label =
    selected.length === 0
      ? "Filter by action"
      : selected.length === 1
        ? auditActionInfo(selected[0]).label
        : `${selected.length} actions`;
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" className="h-10 rounded-lg px-3" />}>
        <Filter className="size-4" aria-hidden />
        {label}
        <ChevronDown className="size-4 opacity-60" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <div className="max-h-80 overflow-y-auto">
          {options.map((option) => (
            <label
              key={option.value}
              className="hover:bg-muted flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
            >
              <Checkbox
                checked={chosen.has(option.value)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...selected, option.value]
                      : selected.filter((value) => value !== option.value)
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ActionLabel({ entry }: { entry: AuditLogEntry }) {
  const info = auditActionInfo(entry.operation);
  const failed = entry.outcome !== "ok";
  return (
    <span className="inline-flex items-center gap-2 font-medium whitespace-nowrap">
      <span className={cn("size-2 shrink-0 rounded-full", failed ? "bg-muted-foreground" : TONE_DOT[info.tone])} aria-hidden />
      <RollInText text={info.label} />
      {failed && <span className="text-muted-foreground text-xs font-normal">Refused</span>}
    </span>
  );
}

function Actor({ entry, names }: { entry: AuditLogEntry; names: AuditNames }) {
  const kind = auditActorKind(entry);
  if (kind === "system") {
    return (
      <span className="inline-flex items-center gap-2">
        <Bot className="text-muted-foreground size-4 shrink-0" aria-hidden />
        System
      </span>
    );
  }
  // A key or a Teammate acts for the Member who minted or asked it; the
  // Member is the second line.
  const primary =
    kind === "apiKey"
      ? `API key "${names.apiKeys[entry.apiKeyId!] ?? "deleted key"}"`
      : kind === "teammate"
        ? `Teammate ${names.teammates[entry.teammateId!] ?? "(retired)"}`
        : entry.memberName || entry.memberEmail || "Former member";
  const secondary = kind === "member" ? (entry.memberName ? entry.memberEmail : null) : entry.memberEmail ?? entry.memberName;
  const Icon = kind === "apiKey" ? KeyRound : kind === "teammate" ? Bot : User;
  return (
    <span className="flex min-w-0 items-start gap-2">
      <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate">{primary}</span>
        {secondary && <span className="text-muted-foreground block truncate text-xs">{secondary}</span>}
      </span>
    </span>
  );
}

/** The operation's own description first; the entities it named otherwise. */
function Target({ entry }: { entry: AuditLogEntry }) {
  if (entry.targetLabel) {
    return (
      <span className="block min-w-0">
        <span className="block truncate font-medium">{entry.targetLabel}</span>
        {entry.targetDetail && (
          <span className="text-muted-foreground block truncate text-xs">{entry.targetDetail}</span>
        )}
      </span>
    );
  }
  const first = entry.entities[0];
  if (!first) return <span className="text-muted-foreground">None</span>;
  return (
    <span className="text-muted-foreground block truncate text-sm">
      {first.kind}
      {entry.entities.length > 1 ? ` and ${entry.entities.length - 1} more` : ""}
    </span>
  );
}

const SURFACES: Record<AuditLogEntry["surface"], string> = {
  console: "Console",
  api: "API",
  mcp: "MCP server",
  teammate: "Teammate",
};

function EntryDetails({
  entry,
  names,
  links,
}: {
  entry: AuditLogEntry;
  names: AuditNames;
  links: Record<string, string>;
}) {
  const changes = Object.entries(entry.changes ?? {});
  return (
    <div className="space-y-6 px-6 pt-2 pb-10">
      <div>
        <p className="text-muted-foreground text-sm">Entry details</p>
        <h2 className="mt-1 text-lg">
          <ActionLabel entry={entry} />
        </h2>
        <p className="text-muted-foreground mt-1 font-mono text-xs">{entry.operation}</p>
      </div>

      <DetailTable
        rows={[
          ["When", formatAuditWhen(entry.createdAt)],
          ["Actor", <Actor key="actor" entry={entry} names={names} />],
          ["Target", <Target key="target" entry={entry} />],
          ["Surface", SURFACES[entry.surface]],
          ["Outcome", entry.outcome === "ok" ? "Done" : `Refused (${entry.outcome})`],
          [
            "Entities",
            entry.entities.length === 0 ? (
              <span className="text-muted-foreground">None</span>
            ) : (
              <ul key="entities" className="space-y-1">
                {entry.entities.map((entity, index) => {
                  const id = entity.id ?? entity.assistantId;
                  const key = `${entity.kind}:${id ?? ""}`;
                  const text = `${entity.kind}${id ? ` · ${id}` : ""}`;
                  return (
                    <li key={`${key}${index}`}>
                      {links[key] ? (
                        <Link href={links[key]} className="press-text text-primary underline-offset-4 hover:underline">
                          {text}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{text}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ),
          ],
        ]}
      />

      {changes.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold">Changes</h3>
          <DetailTable
            rows={changes.map(([field, change]) => [
              field,
              <div
                key={field}
                className="grid items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
              >
                <ChangeValue value={change.before} />
                <ArrowRight className="text-muted-foreground mx-auto size-4 md:mt-3" aria-label="changed to" />
                <ChangeValue value={change.after} />
              </div>,
            ])}
          />
        </section>
      )}
    </div>
  );
}

function ChangeValue({ value }: { value: unknown }) {
  const text = formatChangeValue(value);
  if (typeof value === "object" && value !== null) {
    return (
      <pre className="bg-muted max-h-96 overflow-auto rounded-lg p-3 font-mono text-xs leading-relaxed">
        {text}
      </pre>
    );
  }
  return (
    <span className={cn("block py-2", value == null && "text-muted-foreground")}>{text}</span>
  );
}

function DetailTable({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="text-muted-foreground bg-muted/40 grid grid-cols-[9rem_minmax(0,1fr)] border-b text-xs font-semibold">
        <span className="px-3 py-2">Field</span>
        <span className="border-l px-3 py-2">Value</span>
      </div>
      {rows.map(([field, value]) => (
        <div key={field} className="grid grid-cols-[9rem_minmax(0,1fr)] border-b text-sm last:border-b-0">
          <span className="px-3 py-2.5 font-medium">{field}</span>
          <div className="min-w-0 border-l px-3 py-2.5">{value}</div>
        </div>
      ))}
    </div>
  );
}
