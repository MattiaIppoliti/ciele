import {
  Mailbox,
  Bell,
  BookText,
  ChartLine,
  Compass,
  FlaskConical,
  LayoutGrid,
  Lock,
  MessageCircle,
  MousePointerClick,
  PenTool,
  Phone,
  Plane,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Telescope,
  UsersRound,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  SETTINGS_API_DOMAINS,
  SETTINGS_HOME,
  settingsTabFromPath,
} from "@/components/settings/settings-nav";
import type { ApiV1Domain } from "@/lib/api-v1/meta";
import { DOMAIN_PRESENTATION } from "@/lib/developer-panel/domains";

/** Minimal assistant shape shared by the scope switcher and Find menu. */
export interface AssistantSummary {
  id: string;
  title: string;
  nickname: string;
  /** Widget brand color, tints the assistant's avatar dot in the shell. */
  brandColor?: string | null;
  /** Circular logo, takes priority over `brandColor` in the shell. */
  avatarUrl?: string | null;
}

/** A nav entry's stable name. Code picks entries by this, never by label. */
export type NavId =
  | "assistants"
  | "help-desks"
  | "inbox"
  | "teammates"
  | "improvements"
  | "insights"
  | "eval"
  | "library"
  | "alerts"
  | "settings";

export interface GlobalNavItem {
  id: NavId;
  label: string;
  icon: LucideIcon;
  href: string;
  /** Prefix used for active-state matching (defaults to href). */
  match?: string;
  /** Only highlight on an exact pathname match. */
  exact?: boolean;
  /**
   * Other routes that belong to this entry without being under its prefix,
   * matched the same way (exactly when `exact`, else as a segment prefix).
   */
  also?: string[];
  /** Rendered after the SETUP group, at the bottom of the sidebar nav. */
  bottom?: boolean;
  /** Hidden from anyone who cannot administer the Organization. */
  adminOnly?: boolean;
  /**
   * /api/v1 domains this page can be driven through, newest-first in the order
   * the Developer Panel (#754) should section them. Present means the page gets
   * a Developer Panel button; absent means it deliberately has none, and its
   * absence is accurate information rather than an oversight.
   */
  apiDomains?: ApiV1Domain[];
}

export const GLOBAL_NAV: GlobalNavItem[] = [
  {
    id: "assistants",
    label: "Assistants",
    icon: LayoutGrid,
    href: "/",
    exact: true,
    also: ["/assistants"],
    apiDomains: ["assistants"],
  },
  {
    id: "help-desks",
    label: "Help Desks",
    icon: UsersRound,
    href: "/help-desks",
    apiDomains: ["help-desks"],
  },
  // Reviews rides along (#841): a Human review request is part of a
  // Conversation's transcript, and the panel shows how to list or decide one.
  // Its decision page, `/reviews/<id>`, belongs here for the same reason.
  {
    id: "inbox",
    label: "Inbox",
    icon: Mailbox,
    href: "/inbox",
    also: ["/reviews"],
    apiDomains: ["inbox", "reviews"],
  },
  // The org's internal AI colleagues (#768).
  {
    id: "teammates",
    label: "Teammates",
    // The cursor-click glyph, which the animated-icon registry maps from
    // `MousePointerClick`: a Teammate is a colleague you talk to, not a robot.
    icon: MousePointerClick,
    href: "/teammates",
    // Three domains, because the page renders two rosters and owns a third
    // noun: the Teammates, the channels they share with the team (#778), and
    // the Projects a Teammate attaches to (#771), which are created and edited
    // from here. A channel page nests under this prefix, so it answers with all
    // three as well.
    apiDomains: ["teammates", "channels", "projects"],
  },
  // Projects deliberately have no nav entry: a Project is only ever read by
  // one Teammate (#771), so it is created, attached and edited from the
  // Teammate's own configuration panel rather than a page of its own. The
  // Developer Panel still has to reach the domain from somewhere, which is why
  // the Teammates entry above claims it.
  {
    id: "improvements",
    label: "Improvements",
    icon: FlaskConical,
    href: "/improvements",
    apiDomains: ["improvements"],
  },
  { id: "insights", label: "Insights", icon: ChartLine, href: "/insights" },
  { id: "eval", label: "Eval", icon: Telescope, href: "/eval" },
  // The org-level knowledge hub, shown as "Library" so it never reads as the
  // per-Assistant SETUP → Knowledge section (PRD #726).
  {
    id: "library",
    label: "Library",
    icon: BookText,
    href: "/library",
    apiDomains: ["knowledge"],
  },
  {
    id: "alerts",
    label: "Alerts",
    icon: Bell,
    href: "/alerts",
    bottom: true,
    apiDomains: ["alerts"],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    // Opens the Settings dialog on its first tab. Organization-wide config is
    // all it holds, so the entry is hidden from anyone who cannot change any of
    // it; personal settings stay reachable from the account menu.
    href: SETTINGS_HOME,
    match: "/settings",
    bottom: true,
    adminOnly: true,
  },
];

/** The entry with this id. Every id has one, which `nav.test.ts` pins. */
export function navItem(id: NavId): GlobalNavItem {
  const item = GLOBAL_NAV.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`No nav entry "${id}"`);
  return item;
}

/** `/inbox` and `/inbox/x`, never `/inbox-x`. `/` is under nothing but itself. */
function isUnder(pathname: string, prefix: string): boolean {
  if (prefix === "/") return pathname === "/";
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Whether this entry is the one the route belongs to, highlighted in the sidebar. */
export function navItemActive(item: GlobalNavItem, pathname: string): boolean {
  const prefixes = [item.match ?? item.href, ...(item.also ?? [])];
  return prefixes.some((prefix) =>
    item.exact ? pathname === prefix : isUnder(pathname, prefix)
  );
}

/**
 * The nav entry a route belongs to: the one question the sidebar's highlight,
 * the breadcrumb's first crumb, the Developer Panel's claims and Find's page
 * descriptions all ask, answered once. Null for an Assistant's own pages (their
 * SETUP section answers) and for a route no entry owns.
 *
 * When two prefixes nest, the longer one answers. No two entries nest today,
 * so the sort states the rule rather than breaking a live tie.
 */
export function navItemForPath(pathname: string): GlobalNavItem | null {
  if (assistantIdFromPath(pathname)) return null;
  const longest = (item: GlobalNavItem) =>
    Math.max(...[item.match ?? item.href, ...(item.also ?? [])].map((p) => p.length));
  return (
    GLOBAL_NAV.filter((item) => navItemActive(item, pathname)).sort(
      (a, b) => longest(b) - longest(a)
    )[0] ?? null
  );
}

export interface SetupSection {
  label: string;
  slug: string;
  icon: LucideIcon;
  /** See `GlobalNavItem.apiDomains`. */
  apiDomains?: ApiV1Domain[];
}

/** Types the list as sections while keeping each slug a literal, for `SetupSlug`. */
function setupSections<const Slug extends string>(
  sections: readonly (SetupSection & { slug: Slug })[]
): readonly (SetupSection & { slug: Slug })[] {
  return sections;
}

/** Assistant SETUP sections (mirrors the reference platform's editor rail). */
export const SETUP_SECTIONS = setupSections([
  // First, and deliberately: the editor's docked preview panel is pointer-only
  // chrome hidden below `md`, so this route is the only way to reach the live
  // preview on a phone or a portrait tablet.
  {
    label: "Preview",
    slug: "preview",
    icon: MessageCircle,
  },
  {
    label: "General",
    slug: "general",
    icon: SlidersHorizontal,
    apiDomains: ["assistants"],
  },
  {
    label: "Knowledge",
    slug: "knowledge",
    icon: BookText,
    apiDomains: ["knowledge"],
  },
  {
    label: "Flows",
    slug: "flows",
    icon: Workflow,
    // Applications rides along (#839): a Connector node names a Connection,
    // and the panel shows how to list or re-consent one from here.
    apiDomains: ["flows", "applications", "reviews"],
  },
  {
    label: "Tools & Skills",
    slug: "tools",
    icon: Wrench,
    apiDomains: ["skills", "api-integrations"],
  },
  {
    label: "Goals",
    slug: "goals",
    icon: Compass,
    apiDomains: ["goals"],
  },
  // Guardrails save through the Assistant itself (`assistants.update`), so
  // the Developer Panel shows the assistants domain here.
  {
    label: "Guardrails",
    slug: "guardrails",
    icon: ShieldCheck,
    apiDomains: ["assistants"],
  },
  {
    label: "Assistant Help Desks",
    slug: "help-desks",
    icon: Phone,
    apiDomains: ["help-desks"],
  },
  { label: "Style", slug: "style", icon: PenTool },
  {
    label: "Authentication",
    slug: "authentication",
    icon: Lock,
    apiDomains: ["sso"],
  },
  {
    label: "Publish",
    slug: "publish",
    icon: Plane,
    apiDomains: ["publish"],
  },
]);

/** A SETUP section's route segment. */
export type SetupSlug = (typeof SETUP_SECTIONS)[number]["slug"];

/** Extract the assistant id when the current URL is scoped to one. */
export function assistantIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/assistants\/([^/]+)/);
  return match ? match[1] : null;
}

/** The top-level SETUP section encoded in an Assistant route. Nested state,
 * such as a Flow id, deliberately stays behind the section's route module. */
export function assistantSectionFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/assistants\/[^/]+\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Where a SETUP section leads: straight into the editor when an assistant is
 * in scope, otherwise to the "choose an assistant to continue" picker.
 */
export function setupHref(assistantId: string | null, slug: string): string {
  return assistantId
    ? `/assistants/${assistantId}/${slug}`
    : `/setup/${slug}`;
}

/** Every SETUP section slug, for a lookup by the URL segment. */
export const ASSISTANT_SECTIONS: ReadonlySet<string> = new Set(
  SETUP_SECTIONS.map((section) => section.slug)
);

/**
 * Which /api/v1 domains the current route can be driven through, the one rule
 * deciding whether a page shows a Developer Panel button (#754).
 *
 * An Assistant section answers from its own claim; a global page from its nav
 * entry. `/setup/<section>` deliberately answers nothing: the picker has no
 * Assistant in scope, so every snippet would be a placeholder.
 */
export function apiDomainsForPath(pathname: string): ApiV1Domain[] {
  if (pathname.startsWith("/setup/")) return [];
  // Settings is a dialog over tab routes, so its claims live with its own tab
  // list rather than on the sidebar's single Settings entry.
  const settingsTab = settingsTabFromPath(pathname);
  if (settingsTab) return SETTINGS_API_DOMAINS[settingsTab] ?? [];
  const assistantId = assistantIdFromPath(pathname);
  if (assistantId) {
    const slug = assistantSectionFromPath(pathname);
    // The Assistant Overview is not a SETUP section, but it is the one page
    // whose subject *is* the Assistant, so it answers with that domain.
    if (!slug) return ["assistants"];
    return SETUP_SECTIONS.find((section) => section.slug === slug)?.apiDomains ?? [];
  }
  return navItemForPath(pathname)?.apiDomains ?? [];
}

/** Translate a former query-param editor URL into its canonical route.
 * Returns null when the request already targets the Assistant overview. */
export function legacyAssistantSectionHref(
  assistantId: string,
  search: { page?: string; flowId?: string; c?: string }
): string | null {
  const { page, flowId, c } = search;
  if (!page || page === "overview") return null;
  if (!ASSISTANT_SECTIONS.has(page)) return `/assistants/${assistantId}`;
  if (page === "flows" && flowId) {
    return `/assistants/${assistantId}/flows/${encodeURIComponent(flowId)}`;
  }
  if (page === "knowledge" && c) {
    return `/assistants/${assistantId}/knowledge?c=${encodeURIComponent(c)}`;
  }
  return setupHref(assistantId, page);
}

/**
 * The domains a page's Developer Panel can actually present, what the top-bar
 * button, the panel mount and the `D` shortcut all ask.
 *
 * Claiming a domain and presenting it are two different facts, and asking them
 * separately let them disagree: a claim with no presentation gave no button while
 * `D` still opened an empty panel. `nav.test.ts` forbids that combination, but
 * one predicate means it cannot be expressed at all.
 */
export function panelDomainsForPath(pathname: string): ApiV1Domain[] {
  return apiDomainsForPath(pathname).filter((domain) => DOMAIN_PRESENTATION[domain]);
}
