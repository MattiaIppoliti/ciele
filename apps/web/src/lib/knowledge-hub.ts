import type {
  AssistantSourceLink,
  OrgKnowledgeStatusCounts,
  SourceKind,
  SourceStatus,
} from "@agent-hub/core";

/**
 * Pure derivations for the org-level Knowledge hub (PRD #726): tab → kind
 * buckets, the sub-nav health rollup, filter parsing from URL search params,
 * and small row labels. Client- and server-safe; the page and its client
 * component stay thin shells over these.
 */

export type KnowledgeTabSlug = "websites" | "files" | "faqs";

export const KNOWLEDGE_TAB_SLUGS: KnowledgeTabSlug[] = [
  "websites",
  "files",
  "faqs",
];

/** Which Source kinds each hub tab lists. */
export const KNOWLEDGE_TAB_KINDS: Record<KnowledgeTabSlug, SourceKind[]> = {
  websites: ["website", "url"],
  files: ["file", "text"],
  faqs: ["faq"],
};

export function isKnowledgeTabSlug(value: string): value is KnowledgeTabSlug {
  return (KNOWLEDGE_TAB_SLUGS as string[]).includes(value);
}

/**
 * Sub-nav health dot rollup: error > processing > ready; null (no dot) for an
 * empty tab.
 */
export function tabHealth(
  counts: OrgKnowledgeStatusCounts
): SourceStatus | null {
  if (counts.error > 0) return "error";
  if (counts.processing > 0) return "processing";
  if (counts.ready > 0) return "ready";
  return null;
}

/** The Files tab's Direct access column summary. */
export function directAccessSummary(links: AssistantSourceLink[]): string {
  const on = links.filter((l) => l.directAccess).length;
  if (on === 0) return "No direct access";
  return on === 1 ? "1 assistant" : `${on} assistants`;
}

/** Human label for the hub's Type column. */
export function sourceTypeLabel(kind: SourceKind): string {
  switch (kind) {
    case "website":
      return "Entire website";
    case "url":
      return "Page";
    case "file":
      return "File";
    case "text":
      return "Text";
    case "faq":
      return "FAQ";
  }
}

export const HUB_PAGE_SIZE = 25;

export interface HubSearchParams {
  q: string;
  status: "" | SourceStatus;
  assistant: string;
  page: number;
}

const STATUSES: SourceStatus[] = ["processing", "ready", "error"];

/** Parses + clamps the hub's URL search params; garbage falls back to defaults. */
export function parseHubSearchParams(
  params: Record<string, string | string[] | undefined>
): HubSearchParams {
  const one = (v: string | string[] | undefined): string =>
    (Array.isArray(v) ? v[0] : v) ?? "";
  const status = one(params.status);
  const page = Number.parseInt(one(params.page), 10);
  return {
    q: one(params.q).slice(0, 200),
    status: (STATUSES as string[]).includes(status)
      ? (status as SourceStatus)
      : "",
    assistant: one(params.assistant),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}
