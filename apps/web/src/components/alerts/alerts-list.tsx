"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import type { Alert, AlertType } from "@agent-hub/core";
import { Check, CircleCheck, Ellipsis, LoaderCircle } from "lucide-react";
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
import { SlidingPanel, useSlidingDirection } from "@/components/motion/sliding-panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { useColumnWidths } from "@/components/ui/table-columns";
import { Table, TableActions, TableCard, TableHeader, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { TableColumnHeader, useClientSort } from "@/components/ui/table-column-header";
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
    { key: "actions", width: 100, fixed: true },
  ]);
  const [tab, setTab] = useState<Tab>(initialUrlState.status);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [detected, setDetected] = useState("");
  const [resolved, setResolved] = useState("");
  const order = useClientSort();
  const [details, setDetails] = useState<Alert | null>(null);
  const [pending, startTransition] = useTransition();
  // Which row asked, so "Resolving…" shows on that row and not on all of them.
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const slideDirection = useSlidingDirection(tab, ["all", "active", "resolved"]);
  // A reload or a copied link keeps the tab.
  useEffect(() => {
    replaceFilterParams({ status: tab }, DEFAULT_ALERTS_URL_STATE);
  }, [tab]);

  const activeCount = useMemo(
    () => alerts.filter((a) => a.status === "active").length,
    [alerts]
  );

  const filtered = alerts.filter((alert) =>
    (tab === "all" || alert.status === tab) &&
    (!category || alert.type === category) &&
    (!query || `${alert.title} ${alert.detail}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) &&
    (!detected || formatDateTime(alert.detectedAt).toLocaleLowerCase().includes(detected.toLocaleLowerCase())) &&
    (!resolved || (alert.resolvedAt ? formatDateTime(alert.resolvedAt) : "N/A").toLocaleLowerCase().includes(resolved.toLocaleLowerCase()))
  );
  const visible = order.sorted(filtered, {
    category: (alert) => TYPE_LABELS[alert.type], issue: (alert) => alert.title,
    detected: (alert) => alert.detectedAt, resolved: (alert) => alert.resolvedAt ?? "", status: (alert) => alert.status,
  });

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

      <SlidingPanel activeKey={tab} direction={slideDirection} className="min-h-0 flex-1" panelClassName="touch-scroll-clearance overflow-y-auto px-4 py-4 sm:px-6">
          <TableCard>
            <Table fixed empty={visible.length === 0} aria-label="Alerts">
              {columns.colGroup}
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableColumnHeader label="Category" resize={columns.handleFor("category")} sort={order.column("category", { asc: "A to Z", desc: "Z to A" })} filter={{ kind: "options", value: category, anyLabel: "All categories", options: Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })), onChange: setCategory }} />
                  <TableColumnHeader label="Issue" resize={columns.handleFor("issue")} sort={order.column("issue", { asc: "A to Z", desc: "Z to A" })} filter={{ kind: "text", value: query, placeholder: "Search issues…", onChange: setQuery }} />
                  <TableColumnHeader label="Detected" resize={columns.handleFor("detected")} sort={order.column("detected", { asc: "Oldest first", desc: "Newest first" })} filter={{ kind: "text", value: detected, placeholder: "Search detected dates…", onChange: setDetected }} />
                  <TableColumnHeader label="Resolved" resize={columns.handleFor("resolved")} sort={order.column("resolved", { asc: "Oldest first", desc: "Newest first" })} filter={{ kind: "text", value: resolved, placeholder: "Search resolved dates…", onChange: setResolved }} />
                  <TableColumnHeader label="Status" resize={columns.handleFor("status")} filter={{ kind: "options", value: tab === "all" ? "" : tab, anyLabel: "All statuses", options: [{ value: "active", label: "Active" }, { value: "resolved", label: "Resolved" }], onChange: (value) => setTab(value === "active" || value === "resolved" ? value : "all") }} />
                  <TableColumnHeader label="Actions" align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 && <TableRow><TableCell colSpan={6}><EmptyState
                  icon={<CircleCheck size={24} />}
                  title={alerts.length ? "No matching alerts" : "All clear"}
                  description={alerts.length ? "Try another category or clear the filters." : "No alerts need attention. New issues will appear here."}
                  action={alerts.length ? <Button variant="outline" size="sm" onClick={() => { setCategory(""); setQuery(""); setDetected(""); setResolved(""); setTab("all"); }}>Clear filters</Button> : undefined}
                /></TableCell></TableRow>}
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
                        <TableActions>
                          {canEdit && alert.status === "active" && (
                            <Button variant="ghost" size="icon" disabled={pending} aria-label={`${pending && resolvingId === alert.id ? "Resolving" : "Mark resolved"}: ${alert.title}`} title={pending && resolvingId === alert.id ? "Resolving…" : "Mark resolved"} onClick={() => resolve(alert.id)}>
                              {pending && resolvingId === alert.id ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4 text-emerald-500" aria-hidden="true" />}
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" aria-label={`Details: ${alert.title}`} title="More details" onClick={() => setDetails(alert)}>
                            <Ellipsis className="size-4" aria-hidden="true" />
                          </Button>
                        </TableActions>
                      </TableCell>
                    </TableRow>
                  </RollRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
      </SlidingPanel>

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
    <StatusPill
      status={active ? "error" : "online"}
      primaryText={<RollInText text={active ? "Active" : "Resolved"} />}
    />
  );
}
