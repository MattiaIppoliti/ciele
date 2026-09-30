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
import { useColumnWidths } from "@/components/ui/table-columns";
import { Table, TableCard, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";
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
  const columns = useColumnWidths("alerts", [
    { key: "category", width: 120, min: 105 },
    { key: "issue", width: 380, min: 220 },
    { key: "detected", width: 160, min: 145 },
    { key: "resolved", width: 160, min: 145 },
    { key: "status", width: 110, min: 100 },
    { key: "actions", width: 250, fixed: true },
  ]);
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
      <h1 className="sr-only">Alerts</h1>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        className="mt-4 px-4 sm:px-6"
      >
        <TabsList aria-label="Alert status">
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
          <TableCard>
            <Table fixed aria-label="Alerts">
              {columns.colGroup}
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Category</TableHead>
                  <TableHead>Issue</TableHead>
                  <TableHead>Detected</TableHead>
                  <TableHead>Resolved</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((alert, index) => (
                  <RollRow key={alert.id} index={index}>
                    <TableRow>
                      <TableCell><Badge variant="outline"><RollInText text={TYPE_LABELS[alert.type]} /></Badge></TableCell>
                      <TableCell className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium"><RollInText text={alert.title} /></span>
                        </div>
                        <p className="text-muted-foreground mt-0.5 truncate text-xs">{alert.detail}</p>
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                        <RollInText text={formatDateTime(alert.detectedAt)} />
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                        <RollInText text={alert.resolvedAt ? formatDateTime(alert.resolvedAt) : "N/A"} />
                      </TableCell>
                      <TableCell><StatusBadge status={alert.status} /></TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          {canEdit && alert.status === "active" && (
                            <Button variant="outline" size="sm" disabled={pending} onClick={() => resolve(alert.id)}>
                              <RollInText text={pending && resolvingId === alert.id ? "Resolving…" : "Mark resolved"} />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" aria-label={`Details: ${alert.title}`} onClick={() => setDetails(alert)}>
                            More details
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  </RollRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
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
