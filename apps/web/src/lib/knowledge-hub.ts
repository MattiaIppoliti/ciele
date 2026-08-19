import type {
  AssistantSourceLink,
  OrgKnowledgeStatusCounts,
  SourceKind,
  SourceStatus,
} from "@agent-hub/core";

/**
 * Pure derivations for the Library and the assistant editor's Knowledge
 * section (PRD #726): tab → kind buckets, the sub-nav health rollup, filter
 * parsing from URL search params, small row labels, and the editor's link
 * scoping. Client- and server-safe; the pages and their client components stay
 * thin shells over these.
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

/** The hub tab that lists a given Source kind, the reverse of the map above. */
export function knowledgeTabForKind(kind: SourceKind): KnowledgeTabSlug {
  const slug = KNOWLEDGE_TAB_SLUGS.find((tab) =>
    KNOWLEDGE_TAB_KINDS[tab].includes(kind)
  );
  // Every kind sits in exactly one bucket; the fallback keeps a future kind
  // linking somewhere sane instead of producing a broken href.
  return slug ?? "files";
}

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

/**
 * Narrows a Collection's contents to what one Assistant answers from: the
 * Sources linked to it, and the Concepts derived from those Sources.
 *
 * Collections are org-owned (#741) and hold whatever the Organization put
 * there, while retrieval reads the link set alone (#733), so the assistant
 * editor must scope by link, or it shows (and offers to delete) knowledge
 * belonging to a sibling assistant. A Concept with no Source is unreachable
 * by retrieval and therefore out of scope too.
 */
export function assistantScopedKnowledge<
  S extends { id: string },
  C extends { sourceId: string | null },
>(input: {
  linkedSourceIds: string[];
  sources: S[];
  concepts: C[];
}): { sources: S[]; concepts: C[] } {
  const linked = new Set(input.linkedSourceIds);
  return {
    sources: input.sources.filter((source) => linked.has(source.id)),
    concepts: input.concepts.filter(
      (concept) => concept.sourceId !== null && linked.has(concept.sourceId)
    ),
  };
}

/**
 * Per Source, the *other* Assistants that answer from it, the blast radius of
 * a delete in one Assistant's editor.
 *
 * A Source belongs to the Organization and may be linked to many Assistants
 * (PRD #726), so deleting it from one editor takes knowledge away from the
 * rest. The editor uses this to offer "remove from this assistant" (unlink)
 * where the Source is shared, and to name who else loses it if the admin picks
 * the org-wide delete instead. An entry is absent when nobody else is linked,
 * which is the plain-delete case.
 */
export function sharedAssistantNames(
  assistantId: string,
  items: Array<{ id: string; linkedAssistants: AssistantSourceLink[] }>
): Record<string, string[]> {
  const shared: Record<string, string[]> = {};
  for (const item of items) {
    const others = item.linkedAssistants
      .filter((link) => link.assistantId !== assistantId)
      .map((link) => link.assistantName)
      .filter((name) => name.length > 0)
      .sort((a, b) => a.localeCompare(b));
    if (others.length > 0) shared[item.id] = others;
  }
  return shared;
}

/**
 * What the assistant editor's remove button offers for one Source, given who
 * else answers from it.
 *
 * Unshared, it is a plain delete. Shared, removing means *unlinking*: the
 * Source belongs to the Organization (PRD #726), so deleting it in one
 * assistant's editor would take knowledge away from siblings the editor may
 * not even have open, which is what it did, silently, before this. The
 * org-wide delete stays available as the second, named choice, and the
 * description says exactly who loses the knowledge.
 *
 * Copy only: the caller binds the actions and renders the strings.
 */
export function sourceRemovalChoice(input: {
  name: string;
  /** The other Assistants answering from this Source; empty or absent = none. */
  sharedWith: string[] | undefined;
  /** Label for the org-wide delete, e.g. "Delete website". */
  deleteLabel: string;
  /** One sentence naming what that delete takes with it. */
  deleteEffect: string;
}): {
  mode: "delete" | "unlink";
  name: string;
  description: string;
  confirmLabel: string;
  secondaryLabel?: string;
} {
  const others = input.sharedWith ?? [];
  if (others.length === 0) {
    return {
      mode: "delete",
      name: input.name,
      description: `${input.deleteEffect} This cannot be undone.`,
      confirmLabel: input.deleteLabel,
    };
  }
  const named =
    others.length === 1
      ? others[0]
      : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}`;
  return {
    mode: "unlink",
    name: input.name,
    description: `It stays in the Library and keeps answering for ${named}. Deleting it for the whole organization instead removes it everywhere: ${input.deleteEffect.charAt(0).toLowerCase()}${input.deleteEffect.slice(1)}`,
    confirmLabel: "Remove from this assistant",
    secondaryLabel: "Delete for the organization",
  };
}
