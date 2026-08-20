import {
  Archive,
  Bell,
  BookText,
  ChartLine,
  CircleHelp,
  Compass,
  FlaskConical,
  LayoutGrid,
  Lock,
  MessageCircle,
  PenTool,
  Phone,
  Plane,
  Settings,
  SlidersHorizontal,
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

export interface GlobalNavItem {
  label: string;
  icon: LucideIcon;
  href: string;
  /** Prefix used for active-state matching (defaults to href). */
  match?: string;
  /** Only highlight on an exact pathname match. */
  exact?: boolean;
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
    label: "Assistants",
    icon: LayoutGrid,
    href: "/",
    exact: true,
    apiDomains: ["assistants"],
  },
  {
    label: "Help Desks",
    icon: CircleHelp,
    href: "/help-desks",
    apiDomains: ["help-desks"],
  },
  { label: "Inbox", icon: Archive, href: "/inbox", apiDomains: ["inbox"] },
  {
    label: "Improvements",
    icon: FlaskConical,
    href: "/improvements",
    apiDomains: ["improvements"],
  },
  { label: "Insights", icon: ChartLine, href: "/insights" },
  // The org-level knowledge hub, shown as "Library" so it never reads as the
  // per-Assistant SETUP → Knowledge section (PRD #726, took Data Assistant's
  // slot; that page stays reachable by URL, retirement is a separate decision).
  {
    label: "Library",
    icon: BookText,
    href: "/library",
    apiDomains: ["knowledge"],
  },
  {
    label: "Alerts",
    icon: Bell,
    href: "/alerts",
    bottom: true,
    apiDomains: ["alerts"],
  },
  {
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

export interface SetupSection {
  label: string;
  slug: string;
  icon: LucideIcon;
  enabled: boolean;
  /** See `GlobalNavItem.apiDomains`. */
  apiDomains?: ApiV1Domain[];
}

/** Assistant SETUP sections (mirrors the reference platform's editor rail). */
export const SETUP_SECTIONS: SetupSection[] = [
  // First, and deliberately: the editor's docked preview panel is pointer-only
  // chrome hidden below `md`, so this route is the only way to reach the live
  // preview on a phone or a portrait tablet.
  {
    label: "Preview",
    slug: "preview",
    icon: MessageCircle,
    enabled: true,
  },
  {
    label: "General",
    slug: "general",
    icon: SlidersHorizontal,
    enabled: true,
    apiDomains: ["assistants"],
  },
  {
    label: "Knowledge",
    slug: "knowledge",
    icon: BookText,
    enabled: true,
    apiDomains: ["knowledge"],
  },
  {
    label: "Flows",
    slug: "flows",
    icon: Workflow,
    enabled: true,
    apiDomains: ["flows"],
  },
  {
    label: "Tools & Skills",
    slug: "tools",
    icon: Wrench,
    enabled: true,
    apiDomains: ["skills", "api-integrations"],
  },
  {
    label: "Goals",
    slug: "goals",
    icon: Compass,
    enabled: true,
    apiDomains: ["goals"],
  },
  {
    label: "Assistant Help Desks",
    slug: "help-desks",
    icon: Phone,
    enabled: true,
    apiDomains: ["help-desks"],
  },
  { label: "Style", slug: "style", icon: PenTool, enabled: true },
  {
    label: "Authentication",
    slug: "authentication",
    icon: Lock,
    enabled: true,
    apiDomains: ["sso"],
  },
  {
    label: "Publish",
    slug: "publish",
    icon: Plane,
    enabled: true,
    apiDomains: ["publish"],
  },
];

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

const ASSISTANT_SECTIONS = new Set(SETUP_SECTIONS.map((section) => section.slug));

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
  // When two nav prefixes nest, the more specific one answers. No two nav
  // entries with apiDomains nest today (settings routes returned above), so
  // the sort states the rule rather than breaking a live tie.
  const matches = GLOBAL_NAV.filter((item) => {
    const prefix = item.match ?? item.href;
    return item.exact ? pathname === prefix : pathname.startsWith(prefix);
  }).sort((a, b) => (b.match ?? b.href).length - (a.match ?? a.href).length);
  return matches.find((item) => item.apiDomains)?.apiDomains ?? [];
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
