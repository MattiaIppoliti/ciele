import type { SourceKind } from "@agent-hub/core";

/**
 * The tabs of an Assistant's Knowledge section. Kept out of the client
 * component so the route can read `?mode=` on the server: a drill-down's
 * breadcrumb returns to the tab it was opened from, not to Websites.
 */
export type KnowledgeMode = "websites" | "documents" | "applications" | "faqs" | "concepts";

const MODES: KnowledgeMode[] = ["websites", "documents", "applications", "faqs", "concepts"];

/** Read loosely: an unknown value is the default tab, not an error. */
export function parseKnowledgeMode(value: string | undefined): KnowledgeMode {
  return MODES.includes(value as KnowledgeMode) ? (value as KnowledgeMode) : "websites";
}

/**
 * An Assistant's Knowledge section on the tab a Source of this kind is listed
 * under, for the breadcrumbs of its drill-down. Only Applications needs the
 * parameter today; every other kind opens the default tab.
 */
export function assistantKnowledgeHref(assistantId: string, kind: SourceKind): string {
  const base = `/assistants/${assistantId}/knowledge`;
  return kind === "application" ? `${base}?mode=applications` : base;
}
