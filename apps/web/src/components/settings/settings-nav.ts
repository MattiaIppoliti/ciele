import type { ApiV1Domain } from "@/lib/api-v1/meta";
import { ScanTextIcon } from "@/components/ui/icons/scan-text";
import {
  CalendarClock,
  ScrollText,
  Building2,
  CreditCard,
  Fingerprint,
  Database,
  Gauge,
  Globe,
  KeyRound,
  MessageSquareText,
  Palette,
  Sparkles,
  ShieldCheck,
  Users,
  Webhook,
  Plug,
  type LucideIcon,
  BellDot,
} from "lucide-react";

/**
 * The Settings dialog's own navigation (#settings-modal).
 *
 * Settings is a modal with a tab rail, not six console pages: every tab is still
 * a real route (deep-linkable, server-rendered, RLS-scoped) but the shell around
 * it is the dialog in `settings-dialog.tsx`. This module is the single list the
 * rail, the sidebar entry and the account menu all read, kept in plain TS so the
 * ordering, the scopes and the cross-links are testable (vitest ignores `.tsx`).
 *
 * There are **two scopes**, and the split is a permission boundary, not a
 * grouping: the Organization tabs configure the tenant and are owner/admin only,
 * except the two an Editor may open (Members to read, Business hours to edit),
 * while the personal tabs belong to the signed-in person and every role may open
 * them. Each scope's rail ends with a link into the other one.
 */
export interface SettingsTab {
  label: string;
  slug: string;
  href: string;
  icon: LucideIcon;
}

export type SettingsScope = "organization" | "personal";

/** Organization-wide tabs, the reason that scope is admin-only. */
export const ORG_SETTINGS_TABS: SettingsTab[] = [
  {
    label: "General",
    slug: "general",
    href: "/settings/general",
    icon: Building2,
  },
  { label: "Members", slug: "members", href: "/settings/members", icon: Users },
  { label: "Roles", slug: "roles", href: "/settings/roles", icon: ShieldCheck },
  { label: "Audit log", slug: "audit-log", href: "/settings/audit-log", icon: ScrollText },
  { label: "Data retention", slug: "data-retention", href: "/settings/data-retention", icon: Database },
  { label: "Business hours", slug: "business-hours", href: "/settings/business-hours", icon: CalendarClock },
  { label: "MCP servers", slug: "mcp-servers", href: "/settings/mcp-servers", icon: Plug },
  { label: "Webhooks", slug: "webhooks", href: "/settings/webhooks", icon: Webhook },
  {
    label: "Quick Texts",
    slug: "quick-texts",
    href: "/settings/quick-texts",
    icon: MessageSquareText,
  },
  {
    label: "AI Provider",
    slug: "ai",
    href: "/settings/ai",
    icon: Sparkles,
  },
  {
    label: "Crawling",
    slug: "crawling",
    href: "/settings/crawling",
    icon: Globe,
  },
  {
    label: "API Keys",
    slug: "api-keys",
    href: "/settings/api-keys",
    icon: KeyRound,
  },
  { label: "Usage", slug: "usage", href: "/settings/usage", icon: Gauge },
  {
    label: "Billing",
    slug: "billing",
    href: "/settings/billing",
    icon: CreditCard,
  },
];

/** The signed-in person's own settings, open to every role. */
export const PERSONAL_SETTINGS_TABS: SettingsTab[] = [
  {
    label: "Profile",
    slug: "profile",
    href: "/settings/profile",
    icon: Fingerprint,
  },
  {
    label: "Theme",
    slug: "theme",
    href: "/settings/theme",
    icon: Palette,
  },
  {
    // Personal scope, not organization: the document is the Member's own and
    // no admin surface renders it (#771, story 19).
    label: "Memory",
    slug: "memory",
    href: "/settings/memory",
    icon: ScanTextIcon,
  },
  {
    label: "Notifications",
    slug: "notifications",
    href: "/settings/notifications",
    icon: BellDot,
  },
];

/** Where the sidebar's Settings entry lands (Organization scope). */
export const SETTINGS_HOME = ORG_SETTINGS_TABS[0].href;
/** Where the account menu and the org rail's footer land. */
export const PERSONAL_SETTINGS_HOME = PERSONAL_SETTINGS_TABS[0].href;

/**
 * Which /api/v1 domains each settings route can be driven through (#754).
 *
 * Declared here rather than on the sidebar's single Settings entry because
 * Settings is a dialog over tab routes, not one page: the claims belong with the
 * tab list, the same way an Assistant section claims on `SETUP_SECTIONS`. Tabs
 * absent from this map (Usage, Billing, Profile) deliberately have no Developer
 * Panel.
 */
export const SETTINGS_API_DOMAINS: Record<string, ApiV1Domain[]> = {
  general: ["organization"],
  members: ["members"],
  roles: ["roles"],
  "quick-texts": ["quick-texts"],
  webhooks: ["webhooks"],
  "audit-log": ["audit-log"],
  // The retention windows are fields of the Organization, written by the same
  // `organization update` as its name.
  "data-retention": ["organization"],
  "business-hours": ["business-hours"],
  ai: ["providers", "memories"],
  "api-keys": ["api-keys"],
  usage: ["usage"],
};

/**
 * The rows the sidebar's Settings group unfolds: every Organization tab, then
 * one row into the personal scope, last because it leaves the tenant's
 * configuration for the signed-in person's own. The row is the scope, not its
 * three tabs, so it stays lit on any personal route.
 */
export const SIDEBAR_SETTINGS_ITEMS: SettingsTab[] = [
  ...ORG_SETTINGS_TABS,
  {
    label: "Personal settings",
    slug: "personal-scope",
    href: PERSONAL_SETTINGS_HOME,
    icon: Fingerprint,
  },
];

/** Which sidebar Settings row the pathname lights, or -1 outside Settings. */
export function sidebarSettingsActiveIndex(pathname: string): number {
  const slug = settingsTabFromPath(pathname);
  if (!slug) return -1;
  if (settingsScopeFromPath(pathname) === "personal") {
    return SIDEBAR_SETTINGS_ITEMS.length - 1;
  }
  return SIDEBAR_SETTINGS_ITEMS.findIndex((tab) => tab.slug === slug);
}

/** The tab a pathname is inside, or null when it is not a settings route. */
export function settingsTabFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/settings\/([^/?#]+)/);
  return match ? match[1] : null;
}

/** The open Settings tab's name, for the document title (#1073). */
export function settingsTabLabel(pathname: string): string | null {
  const slug = settingsTabFromPath(pathname);
  if (!slug) return null;
  return [...ORG_SETTINGS_TABS, ...PERSONAL_SETTINGS_TABS].find((tab) => tab.slug === slug)?.label ?? null;
}

const PERSONAL_SLUGS = new Set(PERSONAL_SETTINGS_TABS.map((tab) => tab.slug));

/**
 * Which scope a settings route belongs to. Unknown slugs read as Organization:
 * that scope is the gated one, so an unrecognised route is treated as the more
 * restricted of the two rather than silently shown to everyone.
 */
export function settingsScopeFromPath(pathname: string): SettingsScope {
  const slug = settingsTabFromPath(pathname);
  return slug && PERSONAL_SLUGS.has(slug) ? "personal" : "organization";
}

/**
 * What the signed-in Member may open in the Organization scope, from the
 * settings layout's session. Each flag mirrors the check its route enforces:
 * `manageOrg` every tab, `viewMembers` the Members roster (Editors read it),
 * `editBusinessHours` Business hours.
 */
export interface SettingsAccess {
  manageOrg: boolean;
  viewMembers: boolean;
  editBusinessHours: boolean;
}

/**
 * The tabs one scope's rail lists. `access` is null or absent while the role
 * is still being read, and then the Organization rail lists every tab: the
 * routes enforce their own access, and an empty rail for an Owner on the first
 * render is what crashed `/settings/members`. A role that may open nothing in
 * the scope gets an empty list, which the rail must render.
 */
export function tabsForScope(scope: SettingsScope, access?: SettingsAccess | null): SettingsTab[] {
  if (scope === "personal") return PERSONAL_SETTINGS_TABS;
  if (!access || access.manageOrg) return ORG_SETTINGS_TABS;
  return ORG_SETTINGS_TABS.filter(
    (tab) =>
      (tab.slug === "members" && access.viewMembers) ||
      (tab.slug === "business-hours" && access.editBusinessHours),
  );
}

/** Heading over a scope's rail. */
export function scopeTitle(scope: SettingsScope): string {
  return scope === "personal" ? "Personal" : "Settings";
}

/**
 * The rail's footer: the way into the *other* scope. Personal settings are
 * always reachable; the Organization link is only offered to roles that can
 * change something there (and the routes redirect anyway).
 */
export function crossScopeLink(scope: SettingsScope, access?: SettingsAccess | null): SettingsTab {
  return scope === "personal"
    ? {
        label: "Organization",
        slug: "organization-scope",
        href: tabsForScope("organization", access)[0]?.href ?? SETTINGS_HOME,
        icon: Building2,
      }
    : {
        label: "Personal settings",
        slug: "personal-scope",
        href: PERSONAL_SETTINGS_HOME,
        icon: Fingerprint,
      };
}
