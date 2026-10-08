"use client";

import { TableEditableCell, TableCategory, type TableCategoryTone } from "@/components/ui/table-editable-cell";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import type { Alert, AlertType } from "@agent-hub/core";
import { Check, CircleCheck, Ellipsis, LoaderCircle } from "lucide-react";
import { resolveAlertAction, updateAlertAction } from "@/app/actions";
import { DialogBody, DialogSection, Badge } from "@agent-hub/ui";
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
import { TableColumnHeader, useClientPage, useClientSort } from "@/components/ui/table-column-header";
import { TableFilter, TableSearch } from "@/components/ui/table-filters";
import { TablePagination } from "@/components/ui/table-pagination";
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

  const paged = useClientPage(visible);

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
        onValueChange={(value) => {
          setTab(value as Tab);
          paged.onPageChange(1);
        }}
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

      <SlidingPanel
        activeKey={tab}
        direction={slideDirection}
        className="min-h-0 flex-1"
        panelClassName="touch-scroll-clearance overflow-y-auto px-4 py-4 sm:px-6"
      >
        <TableCard
          title="Alerts"
          results={{ total: visible.length, noun: "alert" }}
          filters={
            <>
              <TableFilter
                label="Category"
                value={category}
                anyLabel="All categories"
                options={Object.entries(TYPE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                onChange={(value) => {
                  setCategory(value);
                  paged.onPageChange(1);
                }}
              />
              <TableFilter
                label="Status"
                value={tab === "all" ? "" : tab}
                anyLabel="All statuses"
                options={[
                  { value: "active", label: "Active" },
                  { value: "resolved", label: "Resolved" },
                ]}
                onChange={(value) => {
                  setTab(
                    value === "active" || value === "resolved" ? value : "all",
                  );
                  paged.onPageChange(1);
                }}
              />
              <TableSearch
                label="Search alerts"
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  paged.onPageChange(1);
                }}
              />
            </>
          }
          footer={
            <TablePagination
              page={paged.page}
              pageSize={paged.pageSize}
              total={visible.length}
              noun="alert"
              onPageChange={paged.onPageChange}
              onPageSizeChange={paged.onPageSizeChange}
            />
          }
        >
          <Table fixed empty={visible.length === 0} aria-label="Alerts">
            {columns.colGroup}
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableColumnHeader
                  label="Category"
                  resize={columns.handleFor("category")}
                  sort={order.column("category", {
                    asc: "A to Z",
                    desc: "Z to A",
                  })}
                  filter={{
                    kind: "options",
                    value: category,
                    anyLabel: "All categories",
                    options: Object.entries(TYPE_LABELS).map(
                      ([value, label]) => ({ value, label }),
                    ),
                    onChange: setCategory,
                  }}
                />
                <TableColumnHeader
                  label="Issue"
                  resize={columns.handleFor("issue")}
                  sort={order.column("issue", {
                    asc: "A to Z",
                    desc: "Z to A",
                  })}
                  filter={{
                    kind: "text",
                    value: query,
                    placeholder: "Search issues…",
                    onChange: setQuery,
                  }}
                />
                <TableColumnHeader
                  label="Detected"
                  resize={columns.handleFor("detected")}
                  sort={order.column("detected", {
                    asc: "Oldest first",
                    desc: "Newest first",
                  })}
                  filter={{
                    kind: "text",
                    value: detected,
                    placeholder: "Search detected dates…",
                    onChange: setDetected,
                  }}
                />
                <TableColumnHeader
                  label="Resolved"
                  resize={columns.handleFor("resolved")}
                  sort={order.column("resolved", {
                    asc: "Oldest first",
                    desc: "Newest first",
                  })}
                  filter={{
                    kind: "text",
                    value: resolved,
                    placeholder: "Search resolved dates…",
                    onChange: setResolved,
                  }}
                />
                <TableColumnHeader
                  label="Status"
                  resize={columns.handleFor("status")}
                  filter={{
                    kind: "options",
                    value: tab === "all" ? "" : tab,
                    anyLabel: "All statuses",
                    options: [
                      { value: "active", label: "Active" },
                      { value: "resolved", label: "Resolved" },
                    ],
                    onChange: (value) =>
                      setTab(
                        value === "active" || value === "resolved"
                          ? value
                          : "all",
                      ),
                  }}
                />
                <TableColumnHeader label="Actions" align="right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState
                      icon={<CircleCheck size={24} />}
                      title={alerts.length ? "No matching alerts" : "All clear"}

                      action={
                        alerts.length ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCategory("");
                              setQuery("");
                              setDetected("");
                              setResolved("");
                              setTab("all");
                            }}
                          >
                            Clear filters
                          </Button>
                        ) : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
              {paged.items.map((alert, index) => (
                <RollRow key={alert.id} index={index}>
                  <TableRow>
                    <TableEditableCell
                      editor={
                        canEdit
                          ? {
                              value: alert.type,
                              label: `Category: ${alert.title}`,
                              options: (
                                Object.keys(TYPE_LABELS) as AlertType[]
                              ).map((value) => ({
                                value,
                                label: TYPE_LABELS[value],
                              })),
                              onSave: (type) =>
                                updateAlertAction(alert.id, { type }),
                            }
                          : undefined
                      }
                    >
                      <TableCategory
                        tone={
                          (
                            {
                              integration: "purple",
                              crawl: "blue",
                              provider: "pink",
                              ingestion: "green",
                              knowledge: "purple",
                              system: "gray",
                            } satisfies Record<AlertType, TableCategoryTone>
                          )[alert.type]
                        }
                      >
                        {TYPE_LABELS[alert.type]}
                      </TableCategory>
                    </TableEditableCell>
                    <TableEditableCell
                      className="min-w-0"
                      editor={
                        canEdit
                          ? {
                              value: `${alert.title}\n${alert.detail}`,
                              label: "Issue",
                              multiline: true,
                              maxLength: 10501,
                              onSave: (value) => {
                                const [title, ...lines] = value.split("\n");
                                return updateAlertAction(alert.id, {
                                  title,
                                  detail: lines.join("\n"),
                                });
                              },
                            }
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">
                          <RollInText text={alert.title} />
                        </span>
                      </div>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {alert.detail}
                      </p>
                    </TableEditableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                      <RollInText text={formatDateTime(alert.detectedAt)} />
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                      <RollInText
                        text={
                          alert.resolvedAt
                            ? formatDateTime(alert.resolvedAt)
                            : "N/A"
                        }
                      />
                    </TableCell>
                    <TableEditableCell
                      editor={
                        canEdit
                          ? {
                              value: alert.status,
                              label: `Status: ${alert.title}`,
                              options: [
                                { value: "active", label: "Active" },
                                { value: "resolved", label: "Resolved" },
                              ],
                              onSave: (status) =>
                                updateAlertAction(alert.id, { status }),
                            }
                          : undefined
                      }
                    >
                      <StatusBadge status={alert.status} />
                    </TableEditableCell>
                    <TableCell>
                      <TableActions>
                        {canEdit && alert.status === "active" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={pending}
                            aria-label={`${pending && resolvingId === alert.id ? "Resolving" : "Mark resolved"}: ${alert.title}`}
                            title={
                              pending && resolvingId === alert.id
                                ? "Resolving…"
                                : "Mark resolved"
                            }
                            onClick={() => resolve(alert.id)}
                          >
                            {pending && resolvingId === alert.id ? (
                              <LoaderCircle
                                className="size-4 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <Check
                                className="size-4 text-emerald-500"
                                aria-hidden="true"
                              />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Details: ${alert.title}`}
                          title="More details"
                          onClick={() => setDetails(alert)}
                        >
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
              <DialogBody>
                <DialogSection>
                  <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {details.detail}
                  </p>
                </DialogSection>
                <DialogSection>
                  <div className="text-muted-foreground grid grid-cols-2 gap-2 text-xs">
                    <span>Detected</span>
                    <span>{formatDateTime(details.detectedAt)}</span>
                    <span>Status</span>
                    <span>
                      {details.status === "active" ? "Active" : "Resolved"}
                    </span>
                    {details.resolvedAt && (
                      <>
                        <span>Resolved</span>
                        <span>{formatDateTime(details.resolvedAt)}</span>
                      </>
                    )}
                  </div>
                </DialogSection>
                <DialogSection>
                  {canEdit && details.status === "active" && (
                    <DialogFooter>
                      <Button
                        loading={pending}
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
                </DialogSection>
              </DialogBody>
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
