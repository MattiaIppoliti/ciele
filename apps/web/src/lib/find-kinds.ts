import type { WireframeKind } from "@/lib/find-pages";

/**
 * The kinds of record the Find palette lists, and everything the palette knows
 * about each one, in one table. The labels, the drawing, whether a preview
 * fetches more, and where a record opens used to be four maps in three files
 * that each had to be edited when a kind was added.
 *
 * Its own module, with no runtime imports, because both `find-index.ts` and
 * `find-pages.ts` read it, and `find-index.ts` already imports `find-pages.ts`.
 */
export type FindKind =
  | "assistant"
  | "conversation"
  | "improvement"
  | "help_desk"
  | "teammate";

export interface FindKindInfo {
  /** What one record is called ("Help desk"). */
  singular: string;
  /** What the kind is called in a filter ("Help desks"). */
  plural: string;
  /** How the preview draws a record of this kind. */
  wireframe: WireframeKind;
  /** The preview reads a detail beyond the list (`readFindDetail` has a reader for it). */
  detail: boolean;
  /** Where a record opens. */
  href: (id: string) => string;
}

/** In the order the Type filter lists them. */
export const FIND_KIND_INFO = {
  assistant: {
    singular: "Assistant",
    plural: "Assistants",
    wireframe: "detail",
    detail: true,
    href: (id) => `/assistants/${id}`,
  },
  conversation: {
    singular: "Conversation",
    plural: "Conversations",
    wireframe: "chat",
    detail: true,
    // The Inbox opens one conversation from its query string. There is no page
    // per conversation.
    href: (id) => `/inbox?conversation=${id}`,
  },
  improvement: {
    singular: "Improvement",
    plural: "Improvements",
    wireframe: "detail",
    detail: false,
    href: (id) => `/improvements/${id}`,
  },
  help_desk: {
    singular: "Help desk",
    plural: "Help desks",
    wireframe: "list",
    detail: true,
    href: (id) => `/help-desks/${id}`,
  },
  teammate: {
    singular: "Teammate",
    plural: "Teammates",
    wireframe: "chat",
    detail: false,
    href: (id) => `/teammates/${id}`,
  },
} as const satisfies Record<FindKind, FindKindInfo>;

export const FIND_KINDS = Object.keys(FIND_KIND_INFO) as FindKind[];

export const isFindKind = (value: unknown): value is FindKind =>
  typeof value === "string" && Object.hasOwn(FIND_KIND_INFO, value);
