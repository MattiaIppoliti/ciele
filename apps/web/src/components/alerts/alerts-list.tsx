"use client";

import { useMemo, useState, useTransition } from "react";
import type { Alert, AlertType } from "@agent-hub/core";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { resolveAlertAction } from "@/app/actions";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui";
import { formatDateTime } from "@/lib/format";

const TYPE_LABELS: Record<AlertType, string> = {
  integration: "Integration",
  crawl: "Crawl",
  provider: "AI Provider",
  ingestion: "Ingestion",
  system: "System",
};

type Tab = "all" | "active" | "resolved";

export function AlertsList({
  alerts,
  canEdit,
}: {
  alerts: Alert[];
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [details, setDetails] = useState<Alert | null>(null);
  const [pending, startTransition] = useTransition();

  const activeCount = useMemo(
    () => alerts.filter((a) => a.status === "active").length,
    [alerts]
  );

  const visible = useMemo(() => {
    if (tab === "active") return alerts.filter((a) => a.status === "active");
    if (tab === "resolved") return alerts.filter((a) => a.status === "resolved");
    return alerts;
  }, [alerts, tab]);

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "all", label: "All" },
    { value: "active", label: `Needs attention (${activeCount})` },
    { value: "resolved", label: "Resolved" },
  ];

  function resolve(alertId: string) {
    startTransition(() => resolveAlertAction(alertId));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
      </header>
      <p className="text-muted-foreground px-6 text-sm">
        Operational issues that need attention — failing integrations, crawls,
        and AI providers. Alerts clear when you resolve them or the underlying
        issue recovers.
      </p>

      <div className="border-border mt-4 flex items-center gap-1 border-b px-6">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.value
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {visible.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm">
            <CircleCheck className="size-8 text-emerald-500" />
            {tab === "resolved"
              ? "No resolved alerts yet."
              : "All clear — no alerts need attention."}
          </div>
        ) : (
          <div className="border-border overflow-hidden rounded-xl border">
            <div className="text-muted-foreground bg-muted/50 grid grid-cols-[1fr_130px_130px_110px_auto] items-center gap-3 px-4 py-2 text-xs font-medium">
              <span>Issue</span>
              <span>Detected</span>
              <span>Resolved</span>
              <span>Status</span>
              <span className="w-40" />
            </div>
            {visible.map((alert) => (
              <div
                key={alert.id}
                className="border-border grid grid-cols-[1fr_130px_130px_110px_auto] items-center gap-3 border-t px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{TYPE_LABELS[alert.type]}</Badge>
                    <span className="truncate font-medium">{alert.title}</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {alert.detail}
                  </p>
                </div>
                <span className="text-muted-foreground text-xs">
                  {formatDateTime(alert.detectedAt)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {alert.resolvedAt ? formatDateTime(alert.resolvedAt) : "—"}
                </span>
                <span>
                  {alert.status === "active" ? (
                    <Badge variant="destructive">
                      <TriangleAlert /> Active
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <CircleCheck /> Resolved
                    </Badge>
                  )}
                </span>
                <div className="flex w-40 justify-end gap-2">
                  {canEdit && alert.status === "active" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => resolve(alert.id)}
                    >
                      I have resolved this
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDetails(alert)}
                  >
                    More details
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={details !== null}
        onOpenChange={(open) => !open && setDetails(null)}
      >
        <DialogContent className="max-w-lg">
          {details && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Badge variant="outline">{TYPE_LABELS[details.type]}</Badge>
                  {details.title}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm whitespace-pre-wrap">{details.detail}</p>
              <div className="text-muted-foreground grid grid-cols-2 gap-2 text-xs">
                <span>Detected</span>
                <span>{formatDateTime(details.detectedAt)}</span>
                <span>Status</span>
                <span>{details.status === "active" ? "Active" : "Resolved"}</span>
                {details.resolvedAt && (
                  <>
                    <span>Resolved</span>
                    <span>{formatDateTime(details.resolvedAt)}</span>
                  </>
                )}
              </div>
              {canEdit && details.status === "active" && (
                <DialogFooter>
                  <Button
                    disabled={pending}
                    onClick={() => {
                      resolve(details.id);
                      setDetails(null);
                    }}
                  >
                    I have resolved this
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
