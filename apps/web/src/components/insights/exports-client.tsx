"use client";

import { useTransition } from "react";
import type { ExportJobKind, ExportJobStatus } from "@agent-hub/core";
import { Download, FileText, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import {
  requestInsightsExportAction,
  retryExportJobAction,
} from "@/app/(admin)/insights/exports/actions";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { formatDateTime } from "@/lib/format";

export interface ExportRow {
  id: string;
  kind: ExportJobKind;
  status: ExportJobStatus;
  format: string;
  error: string;
  createdAt: string;
  updatedAt: string;
  downloadUrl: string | null;
}

const KIND_LABELS: Record<ExportJobKind, string> = {
  insights_overview: "Insights overview",
};

function StatusBadge({ status }: { status: ExportJobStatus }) {
  if (status === "done") return <Badge variant="secondary">Ready</Badge>;
  if (status === "error") return <Badge variant="destructive">Failed</Badge>;
  if (status === "running")
    return (
      <Badge variant="outline">
        <Loader2 className="size-3 animate-spin" /> Generating
      </Badge>
    );
  return <Badge variant="outline">Queued</Badge>;
}

export function ExportsClient({ rows }: { rows: ExportRow[] }) {
  const [pending, startTransition] = useTransition();

  function requestExport() {
    startTransition(() => requestInsightsExportAction());
  }

  function retry(id: string) {
    startTransition(() => retryExportJobAction(id));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Exports</h1>
        <Button
          className="ml-auto h-10 rounded-lg px-4"
          onClick={requestExport}
          disabled={pending}
        >
          <Download className="size-4" /> New export
        </Button>
      </header>
      <p className="text-muted-foreground px-6 text-sm">
        Report exports are generated in the background and appear here with a
        download link. Large reports never block or time out — request one and
        come back when it is ready.
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
            <span className="text-primary/40 flex size-16 items-center justify-center rounded-full border-2 border-dashed">
              <FileText className="size-7" />
            </span>
            <h2 className="text-lg font-semibold">No exports yet</h2>
            <p className="text-muted-foreground max-w-sm text-sm">
              Request an export to generate a downloadable report of your
              analytics.
            </p>
          </div>
        ) : (
          <ul className="divide-border overflow-hidden rounded-xl border divide-y">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <FileText className="text-muted-foreground size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {KIND_LABELS[row.kind]} · {row.format.toUpperCase()}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    Requested {formatDateTime(row.createdAt)}
                    {row.status === "error" && row.error ? ` — ${row.error}` : ""}
                  </p>
                </div>
                <StatusBadge status={row.status} />
                {row.status === "done" && row.downloadUrl && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={row.downloadUrl} download />}
                  >
                    <Download className="size-4" /> Download
                  </Button>
                )}
                {row.status === "error" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => retry(row.id)}
                    disabled={pending}
                  >
                    <RotateCw className="size-4" /> Retry
                  </Button>
                )}
                {row.status === "done" && !row.downloadUrl && (
                  <span className="text-muted-foreground flex items-center gap-1 text-xs">
                    <TriangleAlert className="size-3" /> Link unavailable
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
