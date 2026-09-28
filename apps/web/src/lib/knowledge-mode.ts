import type { SourceKind } from "@agent-hub/core";

/**
 * The tabs of an Assistant's Knowledge section. Kept out of the client
 * component so the route can read `?mode=` on the server: a drill-down's
 * breadcrumb returns to the tab it was opened from, not to Websites.
 */
const MODES = ["websites", "documents", "applications", "faqs", "concepts"] as const;

export type KnowledgeMode = (typeof MODES)[number];

/** Read loosely: an unknown value is the default tab, not an error. */
export function parseKnowledgeMode(value: string | undefined): KnowledgeMode {
  return MODES.find((mode) => mode === value) ?? "websites";
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
