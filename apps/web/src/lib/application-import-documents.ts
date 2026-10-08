import type { ApplicationImportStatus } from "@agent-hub/core";
import { sourceDocumentStatusLabel } from "@agent-hub/core";
import type { BadgeTone } from "@agent-hub/ui";
import type { ApplicationImportDocumentRow } from "@ciele/ops";
import { sourceDocumentTone } from "@/lib/source-documents";
import { parseSourceDocumentsParams } from "@/lib/source-documents";
import { clampPageSize } from "@/lib/pagination";

export function parseApplicationImportDocumentsParams(raw: Record<string, string | string[] | undefined>) {
  return { page: parseSourceDocumentsParams(raw).page, pageSize: clampPageSize(raw.size),
    mimeType: typeof raw.type === "string" ? raw.type.slice(0, 200) : "" };
}

/**
 * Pure derivations for an Application Import's drill-down: the Configured
 * imports table (level 1), the Import's Documents (level 2), and the hop into
 * a Document (level 3, the route every other Source already uses).
 */

/** Where an Import's row opens, from the Library or inside an Assistant. */
export function applicationImportHref(importId: string, assistantId?: string): string {
  return assistantId
    ? `/assistants/${assistantId}/knowledge/imports/${importId}`
    : `/library/imports/${importId}`;
}

/**
 * Where the Source routes live for this surface, without the Source id: the
 * Library's Applications tab, or the Assistant's Knowledge section.
 */
export function applicationSourcePrefix(assistantId?: string): string {
  return assistantId ? `/assistants/${assistantId}/knowledge` : "/library/applications";
}

/**
 * A row opens onto its one Document. With none yet (still processing) or more
 * than one, it opens the Source's own Documents page, which says which.
 */
export function applicationImportRowHref(
  prefix: string,
  row: { sourceId: string; documentId: string | null }
): string {
  const source = `${prefix}/${row.sourceId}`;
  return row.documentId ? `${source}/${row.documentId}` : source;
}

/** One page's href; page one is the bare route. */
export function applicationImportPageHref(base: string, page: number, mimeType = "", pageSize = 25): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (mimeType) params.set("type", mimeType);
  if (pageSize !== 25) params.set("size", String(pageSize));
  return params.size ? `${base}?${params}` : base;
}

type ApplicationImportRowStatus = ApplicationImportDocumentRow["status"];

export function applicationImportRowStatusLabel(status: ApplicationImportRowStatus): string {
  return status === "error" ? "Error" : sourceDocumentStatusLabel(status);
}

export function applicationImportRowTone(status: ApplicationImportRowStatus): BadgeTone {
  return status === "error" ? "red" : sourceDocumentTone(status);
}

/**
 * The Configured imports Status column. The Import's own lifecycle word, in
 * the palette the Library gives a Source: ready answers, syncing is on its
 * way, error went wrong, and a paused Import is an admin's choice.
 */
export function applicationImportStatusTone(
  status: ApplicationImportStatus,
  enabled: boolean
): BadgeTone {
  if (!enabled) return "gray";
  if (status === "error") return "red";
  if (status === "ready") return "green";
  return "amber";
}

export function applicationImportStatusLabel(
  status: ApplicationImportStatus,
  enabled: boolean
): string {
  if (!enabled) return "Paused";
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
}
