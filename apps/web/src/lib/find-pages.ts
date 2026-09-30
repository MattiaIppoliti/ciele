import { ASSISTANT_SECTIONS } from "@/components/shell/nav";
import { FIND_KIND_INFO, type FindKind } from "@/lib/find-kinds";

/**
 * Every console page and Assistant SETUP section the Find palette knows how to
 * describe, in one table.
 *
 * What a page *is* used to be answered by four modules that each kept their own
 * regex table over the same routes (its topic, its drawing, its sub-page links,
 * its card source), so adding a page meant editing all four. Now an entry says
 * everything at once and `describePage(href)` is the one question callers ask:
 * the blurb, the drawing, whether live numbers exist, what the preview fills
 * from the records already read, and where the page leads.
 *
 * Pure, with no reads. `live` only says a loader exists in `find-reads.ts`,
 * which `LiveTopic` makes the compiler check.
 */

export type WireframeKind =
  | "chat"
  | "table"
  | "cards"
  | "kanban"
  | "dashboard"
  | "form"
  | "list"
  | "flow"
  | "detail";

/** A link inside a preview: a name and where it goes. */
export interface PageLink {
  title: string;
  href: string;
}

/** A labelled group of links. */
export interface PageShortcuts {
  label: string;
  links: PageLink[];
}

/** What a page's preview writes in from the records the palette already read. */
export type PageFill =
  | { cards: FindKind }
  | { lanes: "improvements" }
  | { rows: FindKind };

interface PageEntry {
  /** One line on what the page is for. Always shown, costs nothing. */
  blurb: string;
  wireframe: WireframeKind;
  /** A live loader exists for this topic (`find-reads.ts`). */
  live?: true;
  fill?: PageFill;
  /** The page's own sub-pages, static routes of the console. */
  shortcuts?: PageShortcuts;
}

const entries = {
  assistants: {
    blurb: "Every assistant in the organization. Create, duplicate and open them here.",
    wireframe: "cards",
    fill: { cards: "assistant" },
  },
  help_desks_page: {
    blurb: "The people and channels a visitor is handed to when the assistant cannot help.",
    wireframe: "cards",
    fill: { cards: "help_desk" },
  },
  inbox: {
    blurb: "What visitors and members asked, with the answers and how each was handled.",
    wireframe: "list",
    fill: { rows: "conversation" },
  },
  teammates: {
    blurb: "AI colleagues your team chats with inside the console.",
    wireframe: "cards",
    fill: { cards: "teammate" },
  },
  improvements: {
    blurb: "Answers flagged for review, moved across the board until they are fixed.",
    wireframe: "kanban",
    fill: { lanes: "improvements" },
  },
  insights: {
    blurb: "How the assistants perform: volume, resolution, ratings and languages.",
    wireframe: "dashboard",
    live: true,
    shortcuts: {
      label: "Open",
      links: [
        { title: "Overview", href: "/insights" },
        { title: "Costs", href: "/insights/costs" },
        { title: "Observability", href: "/insights/observability" },
        { title: "Exports", href: "/insights/exports" },
      ],
    },
  },
  eval: {
    blurb: "Compare models on the same questions before you switch one on.",
    wireframe: "list",
    live: true,
  },
  library: {
    blurb: "The organization's knowledge: websites, files and FAQs, and who answers from each.",
    wireframe: "table",
    live: true,
    shortcuts: {
      label: "Open",
      links: [
        { title: "Websites", href: "/library/websites" },
        { title: "Files", href: "/library/files" },
        { title: "FAQs", href: "/library/faqs" },
      ],
    },
  },
  alerts: {
    blurb: "Problems that need attention, such as an integration whose credentials stopped working.",
    wireframe: "list",
    live: true,
  },
  settings: {
    blurb: "The organization's profile, members, model providers, API keys, usage and billing.",
    wireframe: "form",
    live: true,
    shortcuts: {
      label: "Open",
      links: [
        { title: "General", href: "/settings/general" },
        { title: "Members", href: "/settings/members" },
        { title: "AI Provider", href: "/settings/ai" },
        { title: "Crawling", href: "/settings/crawling" },
        { title: "API Keys", href: "/settings/api-keys" },
        { title: "Usage", href: "/settings/usage" },
        { title: "Billing", href: "/settings/billing" },
      ],
    },
  },
  preview: {
    blurb: "Chat with the draft assistant exactly as a visitor would, before publishing.",
    wireframe: "chat",
  },
  general: {
    blurb: "Name, welcome message, model and chat defaults.",
    wireframe: "form",
  },
  knowledge: {
    blurb: "The sources this assistant answers from.",
    wireframe: "table",
    live: true,
  },
  flows: {
    blurb: "How a message is routed: the trigger, the conditions and the actions that run.",
    wireframe: "flow",
    live: true,
  },
  tools: {
    blurb: "The tools and skills the assistant may use while answering.",
    wireframe: "cards",
    live: true,
  },
  goals: {
    blurb: "Scheduled questions that check the assistant still answers as expected.",
    wireframe: "list",
    live: true,
  },
  guardrails: {
    blurb: "Checks around every visitor message, and text hidden from answers.",
    wireframe: "list",
    live: true,
  },
  assistant_help_desks: {
    blurb: "Which help desks this assistant may hand a visitor to.",
    wireframe: "list",
    live: true,
  },
  style: {
    blurb: "Colors, launcher and typography of the chat widget.",
    wireframe: "form",
  },
  authentication: {
    blurb: "Whether visitors must sign in before they chat.",
    wireframe: "form",
  },
  publish: {
    blurb: "The widget snapshot and the embed code for your site or LMS.",
    wireframe: "detail",
    live: true,
  },
} as const satisfies Record<string, PageEntry>;

export type PageTopic = keyof typeof entries;

/**
 * Where the things inside a record open, for the links a preview carries. A
 * record's own page is `FIND_KIND_INFO[kind].href`.
 */
export const FIND_ROUTES = {
  collection: (assistantId: string, collectionId: string) =>
    `/assistants/${assistantId}/knowledge?c=${collectionId}`,
  flow: (assistantId: string, flowId: string) => `/assistants/${assistantId}/flows/${flowId}`,
  section: (assistantId: string, slug: string) => `/assistants/${assistantId}/${slug}`,
  evalRun: (runId: string) => `/eval/${runId}`,
  alerts: "/alerts",
  aiProviders: "/settings/ai",
} as const;

/** A route and everything under it: `/inbox`, `/inbox/x`, but not `/inbox-x`. */
const under = (segment: string) => new RegExp(`^/${segment}(?:/|$)`);

const ROUTES: Array<[RegExp, PageTopic]> = [
  [/^\/?$/, "assistants"],
  [/^\/assistants\/?$/, "assistants"],
  [under("help-desks"), "help_desks_page"],
  [under("inbox"), "inbox"],
  [under("teammates"), "teammates"],
  [under("improvements"), "improvements"],
  [under("insights"), "insights"],
  [under("eval"), "eval"],
  [under("library"), "library"],
  [under("alerts"), "alerts"],
  [under("settings"), "settings"],
];

export type PageDescription = PageEntry & {
  topic: PageTopic;
  /** The SETUP section slug, for a section, otherwise null. */
  setupSlug: string | null;
  /** The Assistant a scoped SETUP link points at, otherwise null. */
  assistantId: string | null;
};

/** The path of an href, without query or fragment. */
function pathOf(href: string): string {
  return href.split(/[?#]/)[0] ?? "";
}

const isTopic = (value: string): value is PageTopic => Object.hasOwn(entries, value);

export function describePage(href: string): PageDescription | null {
  const path = pathOf(href);
  const setup = /^\/(?:assistants\/([^/]+)|setup)\/([^/]+)/.exec(path);
  if (setup) {
    const slug = setup[2]!;
    // Each SETUP section's slug is its topic, except `help-desks`: the
    // org-level Help Desks page is `help_desks_page`, the section is this one.
    const topic = slug === "help-desks" ? "assistant_help_desks" : slug;
    if (!ASSISTANT_SECTIONS.has(slug) || !isTopic(topic)) return null;
    return { ...entries[topic], topic, setupSlug: slug, assistantId: setup[1] ?? null };
  }
  const route = ROUTES.find(([pattern]) => pattern.test(path));
  return route ? { ...entries[route[1]], topic: route[1], setupSlug: null, assistantId: null } : null;
}

/** The drawing for a result: by what a record is, by the registry for a page. */
export function wireframeFor(input: {
  record: { kind: FindKind } | null;
  href: string;
}): WireframeKind {
  if (input.record) return FIND_KIND_INFO[input.record.kind].wireframe;
  return describePage(input.href)?.wireframe ?? "detail";
}

/**
 * The topics whose entry says `live: true`. `find-reads.ts` types its loader map
 * as `Record<LiveTopic, Loader>`, so a topic marked live without a loader, or a
 * loader for a topic that is not marked, is a compile error, not a drift found
 * later.
 */
export type LiveTopic = {
  [K in PageTopic]: (typeof entries)[K] extends { live: true } ? K : never;
}[PageTopic];
