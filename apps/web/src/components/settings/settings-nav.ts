import {
  Building2,
  CreditCard,
  Fingerprint,
  Gauge,
  KeyRound,
  Sparkles,
  Users,
  type LucideIcon,
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
 * while the personal tabs belong to the signed-in person and every role may open
 * them. Each scope's rail ends with a link into the other one.
 */
export interface SettingsTab {
  label: string;
  slug: string;
  href: string;
  icon: LucideIcon;
  /** Short line under the label in the rail. */
  hint?: string;
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
  {
    label: "AI Provider",
    slug: "ai",
    href: "/settings/ai",
    icon: Sparkles,
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
];

/** Where the sidebar's Settings entry lands (Organization scope). */
export const SETTINGS_HOME = ORG_SETTINGS_TABS[0].href;
/** Where the account menu and the org rail's footer land. */
export const PERSONAL_SETTINGS_HOME = PERSONAL_SETTINGS_TABS[0].href;

/** The tab a pathname is inside, or null when it is not a settings route. */
export function settingsTabFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/settings\/([^/?#]+)/);
  return match ? match[1] : null;
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

/** The tabs one scope's rail lists. */
export function tabsForScope(scope: SettingsScope): SettingsTab[] {
  return scope === "personal" ? PERSONAL_SETTINGS_TABS : ORG_SETTINGS_TABS;
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
export function crossScopeLink(scope: SettingsScope): SettingsTab {
  return scope === "personal"
    ? {
        label: "Organization",
        slug: "organization-scope",
        href: SETTINGS_HOME,
        icon: Building2,
        hint: "Workspace settings",
      }
    : {
        label: "Personal settings",
        slug: "personal-scope",
        href: PERSONAL_SETTINGS_HOME,
        icon: Fingerprint,
        hint: "Your profile",
      };
}
