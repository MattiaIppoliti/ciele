"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import type { Alert, AlertType } from "@agent-hub/core";
import { CircleCheck } from "lucide-react";
import { TriangleAlert } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { formatDateTime } from "@/lib/format";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { replaceFilterParams } from "@/lib/url-state";
import {
  DEFAULT_ALERTS_URL_STATE,
  type AlertsUrlState,
} from "@/components/alerts/alerts-url-state";

const TYPE_LABELS: Record<AlertType, string> = {
  integration: "Integration",
  crawl: "Crawl",
  provider: "AI Provider",
  ingestion: "Ingestion",
  knowledge: "Knowledge",
  system: "System",
};

type Tab = AlertsUrlState["status"];

/** Shared by the table and its column header, so the two cannot drift apart. */
const COLUMNS = "lg:grid-cols-[1fr_130px_130px_110px_auto]";

export function AlertsList({
  alerts,
  canEdit,
  initialUrlState = DEFAULT_ALERTS_URL_STATE,
}: {
  alerts: Alert[];
  canEdit: boolean;
  /** Parsed on the server, so the first render is already on the right tab. */
  initialUrlState?: AlertsUrlState;
}) {
  const [tab, setTab] = useState<Tab>(initialUrlState.status);
  const [details, setDetails] = useState<Alert | null>(null);
  const [pending, startTransition] = useTransition();
  // Which row asked, so "Resolving…" shows on that row and not on all of them.
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // A reload or a copied link keeps the tab.
  useEffect(() => {
    replaceFilterParams({ status: tab }, DEFAULT_ALERTS_URL_STATE);
  }, [tab]);

  const activeCount = useMemo(
    () => alerts.filter((a) => a.status === "active").length,
    [alerts]
  );

  const visible = useMemo(() => {
    if (tab === "active") return alerts.filter((a) => a.status === "active");
    if (tab === "resolved") return alerts.filter((a) => a.status === "resolved");
    return alerts;
  }, [alerts, tab]);

  const tabs: Array<{ value: Tab; label: ReactNode }> = [
    { value: "all", label: "All" },
    {
      value: "active",
      label: (
        <>
          Needs attention (<RollingNumber value={activeCount} />)
        </>
      ),
    },
    { value: "resolved", label: "Resolved" },
  ];

  function resolve(alertId: string) {
    setResolvingId(alertId);
    startTransition(() => resolveAlertAction(alertId));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight"><RollInText text="Alerts" /></h1>
      </header>
      <p className="text-muted-foreground px-4 text-sm sm:px-6">
        Failing integrations, crawls and providers. Alerts clear when resolved or recovered.
      </p>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        className="mt-4 px-4 sm:px-6"
      >
        <TabsList aria-label="Alert status" className="bg-muted">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {visible.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 py-16 text-sm">
            <CircleCheck className="size-8 text-emerald-500" />
            {tab === "resolved"
              ? "No resolved alerts yet."
              : "All clear, no alerts need attention."}
          </div>
        ) : (
          // Five columns need ~800px. Below `lg` each alert becomes a stacked
          // card instead, the column header disappears with the columns, and
          // the two timestamps carry their own labels once they no longer sit
          // under one. `lg:contents` lets the mobile grouping wrapper vanish so
          // the same cells drop straight into the grid. That is also why this
          // is ARIA table roles and not a <table>: a real table cannot stack.
          <div
            role="table"
            aria-label="Alerts"
            className="border-border overflow-hidden rounded-xl border"
          >
            <div role="rowgroup">
              <div
                role="row"
                className={`text-muted-foreground bg-muted/50 hidden items-center gap-3 px-4 py-2 text-xs font-medium lg:grid ${COLUMNS}`}
              >
                <span role="columnheader">Issue</span>
                <span role="columnheader">Detected</span>
                <span role="columnheader">Resolved</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">
                  <span className="sr-only">Actions</span>
                </span>
              </div>
            </div>
            <div role="rowgroup">
              {visible.map((alert) => (
                <div
                  key={alert.id}
                  role="row"
                  className={`border-border flex flex-col gap-2 border-t px-4 py-3 text-sm lg:grid lg:items-center lg:gap-3 ${COLUMNS}`}
                >
                  <div role="cell" className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{TYPE_LABELS[alert.type]}</Badge>
                      <span className="truncate font-medium">{alert.title}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs [overflow-wrap:anywhere] lg:truncate">
                      {alert.detail}
                    </p>
                  </div>
                  <div
                    role="none"
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 lg:contents"
                  >
                    <span role="cell" className="text-muted-foreground text-xs">
                      <span className="lg:hidden">Detected: </span>
                      {formatDateTime(alert.detectedAt)}
                    </span>
                    <span role="cell" className="text-muted-foreground text-xs">
                      <span className="lg:hidden">Resolved: </span>
                      {alert.resolvedAt ? formatDateTime(alert.resolvedAt) : "N/A"}
                    </span>
                  </div>
                  <span role="cell">
                    <StatusBadge status={alert.status} />
                  </span>
                  {/* No fixed width: two buttons never fitted 10rem, so the
                      resolve action used to overlap the status badge. The
                      column is `auto`, so it sizes to whatever the row needs. */}
                  <div
                    role="cell"
                    className="flex flex-wrap gap-2 lg:flex-nowrap lg:justify-end"
                  >
                    {canEdit && alert.status === "active" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => resolve(alert.id)}
                      >
                        {pending && resolvingId === alert.id
                          ? "Resolving…"
                          : "Mark resolved"}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Details: ${alert.title}`}
                      onClick={() => setDetails(alert)}
                    >
                      More details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
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
                <DialogTitle className="flex min-w-0 items-center gap-2 [overflow-wrap:anywhere]">
                  <Badge variant="outline">{TYPE_LABELS[details.type]}</Badge>
                  <span className="min-w-0">{details.title}</span>
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{details.detail}</p>
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
                    Mark resolved
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

/** One badge whose label rolls when an alert clears, rather than a swap. */
function StatusBadge({ status }: { status: Alert["status"] }) {
  const active = status === "active";
  return (
    <Badge variant={active ? "destructive" : "secondary"}>
      {active ? <TriangleAlert /> : <CircleCheck />}
      <RollInText text={active ? "Active" : "Resolved"} />
    </Badge>
  );
}
