import {
  Archive,
  Bell,
  BookText,
  ChartLine,
  CircleHelp,
  Database,
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
import { SETTINGS_HOME } from "@/components/settings/settings-nav";

/** Minimal assistant shape shared by the scope switcher and Find menu. */
export interface AssistantSummary {
  id: string;
  title: string;
  nickname: string;
  /** Widget brand color — tints the assistant's avatar dot in the shell. */
  brandColor?: string | null;
  /** Circular logo — takes priority over `brandColor` in the shell. */
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
}

export const GLOBAL_NAV: GlobalNavItem[] = [
  { label: "Assistants", icon: LayoutGrid, href: "/", exact: true },
  { label: "Help Desks", icon: CircleHelp, href: "/help-desks" },
  { label: "Inbox", icon: Archive, href: "/inbox" },
  { label: "Improvements", icon: FlaskConical, href: "/improvements" },
  { label: "Insights", icon: ChartLine, href: "/insights" },
  { label: "Data Assistant", icon: Database, href: "/data-assistant" },
  { label: "Alerts", icon: Bell, href: "/alerts", bottom: true },
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
}

/** Assistant SETUP sections (mirrors the reference platform's editor rail). */
export const SETUP_SECTIONS: SetupSection[] = [
  // First, and deliberately: the editor's docked preview panel is pointer-only
  // chrome hidden below `md`, so this route is the only way to reach the live
  // preview on a phone or a portrait tablet.
  {
    label: "Preview Chatbot",
    slug: "preview",
    icon: MessageCircle,
    enabled: true,
  },
  { label: "General", slug: "general", icon: SlidersHorizontal, enabled: true },
  { label: "Knowledge", slug: "knowledge", icon: BookText, enabled: true },
  { label: "Flows", slug: "flows", icon: Workflow, enabled: true },
  { label: "Tools & Skills", slug: "tools", icon: Wrench, enabled: true },
  { label: "Goals", slug: "goals", icon: Compass, enabled: true },
  {
    label: "Assistant Help Desks",
    slug: "help-desks",
    icon: Phone,
    enabled: true,
  },
  { label: "Style", slug: "style", icon: PenTool, enabled: true },
  {
    label: "Authentication",
    slug: "authentication",
    icon: Lock,
    enabled: true,
  },
  { label: "Publish", slug: "publish", icon: Plane, enabled: true },
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
