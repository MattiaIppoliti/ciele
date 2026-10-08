"use client";

import { ExternalLink } from "lucide-react";
import { StatusBadge } from "@/components/spaceui/status-badge";
import { Table, type TableColumn } from "@/components/motion/table";
import { EMPTY_FIELD, type InvoiceRow } from "@/lib/billing-account-view";

export function BillingInvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  const columns: TableColumn<InvoiceRow>[] = [
    { key: "date", header: "Date", accessor: (row) => row.dateLabel },
    { key: "number", header: "Number", accessor: (row) => row.numberLabel },
    { key: "status", header: "Status", accessor: (row) => row.statusLabel,
      filterLabel: "Status", filterAnyLabel: "All statuses",
      filterOptions: [...new Set(rows.map((row) => row.statusLabel))].map((value) => ({ value, label: value })),
      cell: (row) => <StatusBadge status={row.statusVariant === "secondary" ? "online" : row.statusVariant === "destructive" ? "error" : "away"}
        primaryText={row.statusLabel} /> },
    { key: "total", header: "Total", accessor: (row) => row.amountLabel, align: "right" },
    { key: "actions", header: "Invoice", align: "right", cell: (row) => row.url ?
      <a href={row.url} target="_blank" rel="noopener noreferrer" aria-label={`View invoice ${row.numberLabel} (opens in new tab)`}
        className="press-text inline-flex items-center gap-1 underline underline-offset-4">
        View <ExternalLink className="size-3" aria-hidden="true" />
      </a> : EMPTY_FIELD },
  ];
  return <Table title="Invoices" noun="invoice" data={rows} columns={columns} getRowId={(row) => row.id}
    emptyState="No invoices yet" />;
}
