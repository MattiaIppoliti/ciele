"use client";
import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { SlotPortal, TOP_BAR_SLOT } from "@/components/shell/slot-portal";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ExportJobKind, ExportJobStatus, InsightsFilter } from "@agent-hub/core";
import { Download, FileText, RotateCw } from "lucide-react";
import { Loader2, TriangleAlert } from "lucide-react";
import { retryExportJobAction } from "@/app/(admin)/insights/exports/actions";
import { CreateExportDialog } from "@/components/insights/create-export-dialog";

import { Button } from "@agent-hub/ui";
import { formatCount, formatDateTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";

export interface ExportRow {
  id: string;
  /** The name given in Create export; null on an export from before names existed. */
  name: string | null;
  kind: ExportJobKind;
  status: ExportJobStatus;
  format: string;
  error: string;
  createdAt: string;
  updatedAt: string;
  downloadUrl: string | null;
}

const KIND_LABELS: Record<ExportJobKind, string> = {
  insights_overview: "Aggregated insights",
  insights_datapoints: "Datapoints",
  insights_languages: "Languages",
};

/** How often the list re-reads itself while a job is still building. */
const POLL_MS = 4000;

const STATUS: Record<
  ExportJobStatus,
  { label: string; variant: "secondary" | "destructive" | "outline" }
> = {
  queued: { label: "Queued", variant: "outline" },
  running: { label: "Generating", variant: "outline" },
  done: { label: "Ready", variant: "secondary" },
  error: { label: "Failed", variant: "destructive" },
};

function StatusBadge({ status }: { status: ExportJobStatus }) {
  const { label } = STATUS[status];
  return (
    <StatusPill
      status={status === "done" ? "online" : status === "error" ? "error" : status === "running" ? "info" : "away"}
      animated={status === "running"}
      primaryText={<RollInText text={label} />}
    />
  );
}

const inProgress = (row: ExportRow) => row.status === "queued" || row.status === "running";

export function ExportsClient({
  rows,
  assistants,
  defaultFilter,
}: {
  rows: ExportRow[];
  assistants: Array<{ id: string; title: string }>;
  defaultFilter: InsightsFilter;
}) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const active = rows.filter(inProgress).length;

  // The job runs off the request path, so nothing pushes its progress here:
  // re-read the page until every job has settled.
  useEffect(() => {
    if (active === 0) return;
    const id = window.setInterval(() => router.refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [active, router]);

  function retry(id: string) {
    setRetryingId(id);
    startRetry(async () => {
      try {
        await retryExportJobAction(id);
        toast.success("Export queued again.");
      } catch {
        toast.error("Couldn't retry the export. Reload the page and try again.");
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <SlotPortal id={TOP_BAR_SLOT}>
        <CreateExportDialog assistants={assistants} defaultFilter={defaultFilter} />
      </SlotPortal>

      <p role="status" aria-live="polite" className="sr-only">
        {active > 0
          ? `${formatCount(active)} export${active === 1 ? "" : "s"} in progress…`
          : rows.length > 0
            ? "No exports in progress."
            : ""}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {rows.length === 0 ? (
          <EmptyState
            className="rounded-xl border border-dashed"
            title="No exports yet"

          />
        ) : (
          <ul className="divide-border overflow-hidden rounded-xl border divide-y">
            {rows.map((row, index) => (
              <RollRow key={row.id} index={index}>
              <li className="flex flex-wrap items-center gap-3 px-4 py-3">
                <FileText className="text-muted-foreground size-5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    <RollInText text={row.name ?? KIND_LABELS[row.kind]} />
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    <RollInText text={`${KIND_LABELS[row.kind]} · ${row.format.toUpperCase()}`} />
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    <RollInText text={`Requested ${formatDateTime(row.createdAt)} UTC`} />
                  </p>
                  {row.status === "error" && row.error && (
                    <p className="text-destructive mt-0.5 text-xs break-words">
                      {row.error.replace(/\.?$/, ".")} Retry, or request a new export if it
                      fails again.
                    </p>
                  )}
                </div>
                <StatusBadge status={row.status} />
                {row.status === "done" && row.downloadUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={row.downloadUrl} download />}
                  >
                    <Download className="size-4" aria-hidden /> Download
                  </Button>
                )}
                {row.status === "error" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => retry(row.id)}
                    disabled={retrying && retryingId === row.id}
                  >
                    {retrying && retryingId === row.id ? (
                      <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                    ) : (
                      <RotateCw className="size-4" aria-hidden />
                    )}{" "}
                    Retry
                  </Button>
                )}
                {row.status === "done" && !row.downloadUrl && (
                  <span className="text-muted-foreground flex items-center gap-1 text-xs">
                    <TriangleAlert className="size-3" aria-hidden /> Link unavailable
                  </span>
                )}
              </li>
              </RollRow>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
