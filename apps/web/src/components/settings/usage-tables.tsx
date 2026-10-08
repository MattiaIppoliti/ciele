"use client";

import type { UsageDailyRow, UsageEventRow } from "@agent-hub/core";
import { Table, type TableColumn } from "@/components/motion/table";
import { formatCount, formatDay } from "@/lib/format";

const credentials: Record<UsageDailyRow["credentialKind"], string> = {
  platform: "Platform", api_key: "Your API key", google_vertex_federated: "Federated (Vertex)",
  local_subscription: "Local subscription", ai_gateway: "Your AI Gateway key", unknown: "Unrecorded",
};
const kinds: Record<UsageDailyRow["kind"], string> = { chat: "Chat", embedding: "Embedding", crawl: "Crawl" };
const operations: Record<UsageEventRow["operation"], string> = {
  api_request: "API request", send_email: "Email", http_flow_run: "Inbound flow run", webhook_call: "Webhook callback",
};
const outcomes: Record<UsageEventRow["status"], string> = {
  succeeded: "Completed", failed: "Failed", refused: "Refused by Ciele",
};
const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));
const dailyColumns: TableColumn<UsageDailyRow>[] = [
  { key: "day", header: "Day", accessor: r => r.day, cell: r => formatDay(r.day), sortable: true },
  { key: "kind", header: "Kind", accessor: r => r.kind, cell: r => kinds[r.kind], filterLabel: "Kind", filterOptions: options(kinds) },
  { key: "credential", header: "Credential", accessor: r => r.credentialKind, cell: r => credentials[r.credentialKind], filterLabel: "Credential", filterOptions: options(credentials) },
  { key: "model", header: "Ran on", accessor: r => r.modelId || r.provider || "N/A", sortable: true },
  { key: "calls", header: "Calls", accessor: r => r.calls, cell: r => formatCount(r.calls), align: "right", sortable: true },
  { key: "tokens", header: "Tokens in · out", accessor: r => r.inputTokens + r.outputTokens, cell: r => r.kind === "crawl" ? "N/A" : `${formatCount(r.inputTokens)} · ${formatCount(r.outputTokens)}`, align: "right", sortable: true },
  { key: "pages", header: "Pages", accessor: r => r.units, cell: r => r.kind === "crawl" ? formatCount(r.units) : "N/A", align: "right", sortable: true },
];
const operationColumns: TableColumn<UsageEventRow>[] = [
  { key: "operation", header: "Operation", accessor: r => r.operation, cell: r => operations[r.operation], filterLabel: "Operation", filterOptions: options(operations) },
  { key: "status", header: "Outcome", accessor: r => r.status, cell: r => outcomes[r.status], filterLabel: "Outcome", filterOptions: options(outcomes) },
  { key: "count", header: "Count", accessor: r => r.quantity, cell: r => formatCount(r.quantity), sortable: true, align: "right" },
];

export function DailyUsageTable({ rows }: { rows: UsageDailyRow[] }) {
  return <Table noun="usage entry" pluralNoun="usage entries" data={rows} columns={dailyColumns}
    getRowId={r => `${r.day}-${r.kind}-${r.credentialKind}-${r.provider}-${r.modelId}`}
    searchValue={r => `${formatDay(r.day)} ${kinds[r.kind]} ${credentials[r.credentialKind]} ${r.modelId} ${r.provider}`}
    emptyState="No usage yet. It appears once an assistant answers, indexes or crawls." />;
}

export function UsageOperationsTable({ rows }: { rows: UsageEventRow[] }) {
  return <Table noun="operation" data={rows} columns={operationColumns}
    getRowId={r => `${r.operation}-${r.status}`} searchValue={r => `${operations[r.operation]} ${outcomes[r.status]}`}
    emptyState="No operations in this range." />;
}
