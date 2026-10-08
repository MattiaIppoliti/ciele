"use client";

import { prefetchFind } from "@/lib/find-client";
import Link, { useLinkStatus } from "next/link";
import { useState, useTransition } from "react";
import type { Organization, Profile, Role } from "@agent-hub/core";
import { Bot, ChevronsUpDown, LifeBuoy, Search, Settings, type LucideIcon } from "lucide-react";
import { BookOpen, Check, Loader2, Map as MapIcon, MessageCircleQuestion, Ticket } from "lucide-react";
import { SidebarToggleIcon } from "@/components/ui/sidebar-toggle-icon";
import { AnimatedGlyph, AnimatedIcon } from "@/components/ui/animated-icon";
import { localGlyphFor } from "@/components/ui/icons/local-glyphs";
import { switchOrganizationAction } from "@/app/actions";
import { Badge } from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@agent-hub/ui";
import { HoverHighlight } from "@/components/ui/hover-highlight";
import { Button as CieleButton, Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import { MobileNavigation } from "@/components/shell/mobile-navigation";
import { SidebarFrame } from "@/components/shell/sidebar-frame";
import {
  GLOBAL_NAV,
  SETUP_SECTIONS,
  assistantIdFromPath,
  assistantSectionFromPath,
  navItem,
  navItemActive,
  type NavId,
  setupHref,
} from "@/components/shell/nav";
import { NavFoldGroup, NavSection } from "@/components/shell/nav-tree";
import { useUnderlyingPathname } from "@/components/shell/use-underlying-pathname";
import {
  PERSONAL_SETTINGS_HOME,
  SETTINGS_HOME,
  SIDEBAR_SETTINGS_ITEMS,
  sidebarSettingsActiveIndex,
} from "@/components/settings/settings-nav";
import {
  useShell,
} from "@/components/shell/shell-provider";
import { canManageMembers } from "@/lib/rbac";
import { canAutoFocus } from "@/lib/auto-focus";
import { formatCount } from "@/lib/format";
import { RollingNumber } from "@/components/motion/rolling-number";
import {
  ChatSidebarSlotHost,
  NewChatButton,
  isChatPath,
  QuickLinks,
} from "@/components/shell/sidebar-chat-controls";
import { ROW_IDLE } from "@/components/shell/sidebar-row";

interface AppSidebarProps {
  orgId: string;
  orgName: string;
  orgLogoUrl?: string | null;
  /** Every Organization the caller can switch into, a platform superuser
   * sees every Organization, everyone else just their own. */
  organizations: Organization[];
  email: string;
  role: Role | null;
  demo: boolean;
  /** The signed-in caller's own profile, bottom account row + menu. */
  profile: Profile | null;
  /** Active operational alerts, rendered as the Alerts nav badge. */
  alertCount: number;
  /**
   * Groups where this Member was named and has not read it, as the Teammates
   * nav badge (#778). Counted per group: being named five times in one thread is
   * one place to go, and a badge that counted mentions would say "12" about a
   * single conversation.
   */
  mentionCount: number;
}

const ROW_ACTIVE = "bg-muted text-foreground";

function rowClass(collapsed: boolean) {
  return `press relative flex h-8 items-center rounded-md text-sm font-medium transition-[color,background-color,opacity] has-[[data-pending]]:opacity-60 ${
    collapsed ? "w-9 justify-center self-center" : "w-full gap-2.5 px-2.5"
  }`;
}

/**
 * Pending state for the row the user just clicked.
 *
 * Server navigation in this app can take a beat, and `loading.tsx` only
 * appears once the router commits, so without this the click is
 * unacknowledged: the dead-click case response feedback exists to prevent.
 *
 * It used to be a white bar down the row's left edge, which read as a second
 * active marker beside the one `bg-muted` already draws, on the wrong row.
 * The row dims instead: the same thing every other pending control in the
 * console does, and it says "working" without claiming to be selected.
 *
 * `useLinkStatus` has to be called from inside the <Link>, which is why this
 * is its own component rather than a flag on NavRow.
 */
function NavRowPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <span aria-hidden data-pending="" className="hidden" />;
}

function NavRow({
  icon: Icon,
  label,
  href,
  active,
  badge = 0,
  collapsed,
}: {
  icon?: LucideIcon;
  label: string;
  href: string;
  active: boolean;
  /** Numeric badge (e.g. active alert count), a dot when collapsed. */
  badge?: number;
  collapsed: boolean;
}) {
  const localGlyph = localGlyphFor(Icon);
  const row = (
    <Link
      href={href}
      // The label overrides the row's text, so the count has to be in it too.
      aria-label={badge > 0 ? `${label} (${formatCount(badge)})` : label}
      aria-current={active ? "page" : undefined}
      data-highlight-row
      className={`${rowClass(collapsed)} ${active ? ROW_ACTIVE : ROW_IDLE}`}
    >
      {/* `data-nav-target`: inside a fold group, a click here opens the
          row's page and a click on the rest of the row folds the group. */}
      {/* `flex items-center`, not `block`: a block span takes the row's line
          height, not the icon's, and left every glyph ~2px above its label. */}
      <span data-nav-target className="relative flex shrink-0 items-center justify-center">
        {localGlyph ? (
          <AnimatedGlyph icon={localGlyph} size={16} className="shrink-0" />
        ) : Icon ? (
          <AnimatedIcon icon={Icon} size={16} className="shrink-0" />
        ) : null}
        {badge > 0 && collapsed && (
          <span aria-hidden className="absolute -top-1 -right-1 size-2 rounded-full bg-red-500" />
        )}
      </span>
      {!collapsed && (
        <span data-nav-target className="truncate">
          {label}
        </span>
      )}
      {badge > 0 && !collapsed && (
        <span
          aria-hidden
          className="ml-auto rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white"
        >
          <RollingNumber value={badge} />
        </span>
      )}
      <NavRowPending />
    </Link>
  );
  if (!collapsed) return row;
  return (
    <Hint label={label} side="right">
      {row}
    </Hint>
  );
}

function OrgAvatar({ name, logoUrl }: { name: string; logoUrl?: string | null }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className="size-7 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * Vercel-style organization switcher: a circular org avatar that opens a
 * popover with a search box and every Organization the caller can switch
 * into (a platform superuser sees every org; everyone else just their own)
 * plus a settings gear on the active row, visible only to roles that can
 * manage members, linking straight to the org's Members page.
 */
function OrgAvatarSwitcher({
  orgId,
  orgName,
  orgLogoUrl,
  organizations,
  role,
  demo,
  collapsed,
}: {
  orgId: string;
  orgName: string;
  orgLogoUrl?: string | null;
  organizations: Organization[];
  role: Role | null;
  demo: boolean;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  /** The row that was clicked, so only it shows the wait. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const canManage = canManageMembers(role);
  const roleLabel = demo ? "Demo" : role ?? "Member";

  const filtered = organizations.filter((org) =>
    org.name.toLowerCase().includes(query.toLowerCase())
  );

  function switchTo(id: string) {
    if (id === orgId) {
      setOpen(false);
      return;
    }
    setPendingId(id);
    startTransition(async () => {
      await switchOrganizationAction(id);
      setOpen(false);
      setQuery("");
    });
  }

  const trigger = (
    <PopoverTrigger
      render={
        <button
          type="button"
          aria-label="Switch organization"
          className={
            collapsed
              ? "flex items-center justify-center rounded-full transition-shadow hover:ring-2 hover:ring-black/10"
              : // A container, so what it holds can give way in order as the
                // sidebar is dragged narrower: the name truncates first, then
                // the role badge goes, then the chevron. Nothing may spill
                // into Find and the toggle beside it.
                "press hover:bg-muted @container -mx-1 flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg px-1 py-1 text-left transition-colors"
          }
        />
      }
    >
      <OrgAvatar name={orgName} logoUrl={orgLogoUrl} />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">
            {orgName}
          </span>
          <Badge variant="secondary" className="shrink-0 capitalize @max-[8.5rem]:hidden">
            {roleLabel}
          </Badge>
          <AnimatedIcon
            icon={ChevronsUpDown}
            size={14}
            iconClassName="text-muted-foreground"
            className="shrink-0 @max-[4.5rem]:hidden"
          />
        </>
      )}
    </PopoverTrigger>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      {collapsed ? (
        <Hint label="Switch organization" side="right">
          {trigger}
        </Hint>
      ) : (
        trigger
      )}
      <PopoverContent align="start" className="organization-switcher-popover w-72 p-0">
        <div className="has-[:focus-visible]:ring-ring/50 flex items-center gap-2 border-b px-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset">
          <Search aria-hidden className="text-muted-foreground size-4 shrink-0" />
          <input
            autoFocus={canAutoFocus()}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find Organization…"
            aria-label="Find organization"
            autoComplete="off"
            spellCheck={false}
            className="placeholder:text-muted-foreground h-10 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <HoverHighlight data-foley-scroll="" className="max-h-72 overflow-y-auto overscroll-contain p-1.5">
          {filtered.map((org) => {
            const active = org.id === orgId;
            return (
              <div
                key={org.id}
                data-highlight-row
                className="relative flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
              >
                <button
                  type="button"
                  // aria-disabled, not disabled: disabling the focused row
                  // would drop keyboard focus to the body mid-switch.
                  aria-disabled={isPending || undefined}
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    if (!isPending) switchTo(org.id);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left aria-disabled:opacity-50"
                >
                  <OrgAvatar name={org.name} logoUrl={org.logoUrl} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {org.name}
                  </span>
                  {isPending && pendingId === org.id && (
                    <Loader2 aria-label="Switching…" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
                  )}
                </button>
                {active && (
                  <>
                    <Badge variant="secondary" className="shrink-0 capitalize">
                      {roleLabel}
                    </Badge>
                    <Check aria-hidden className="size-4 shrink-0" />
                  </>
                )}
                {active && canManage && (
                  <Hint label="Manage members">
                    <CieleButton variant="ghost" size="icon-sm" render={<Link href="/settings/members" />}

                      aria-label="Manage members"
                      onClick={() => setOpen(false)}
                      className="press-control text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-md transition-colors"
                    >
                      <AnimatedIcon icon={Settings} size={14} />
                    </CieleButton>
                  </Hint>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-muted-foreground px-2.5 py-3 text-center text-sm">
              No organizations found.
            </p>
          )}
        </HoverHighlight>
      </PopoverContent>
    </Popover>
  );
}

const SUPPORT_LINKS = [
  { label: "Help Guides", icon: BookOpen, href: "https://docs.ciele.app" },
  { label: "Support Portal", icon: Ticket },
  { label: "Product Roadmap", icon: MapIcon, href: "https://ciele.app/change-log" },
  { label: "Chat with Support", icon: MessageCircleQuestion },
] as const;

function SidebarContent({
  orgId,
  orgName,
  orgLogoUrl,
  organizations,
  email,
  role,
  demo,
  profile,
  alertCount,
  mentionCount,
  collapsed,
  onToggle,
  toggleLabel,
}: AppSidebarProps & {
  collapsed: boolean;
  onToggle: () => void;
  /** What the toggle does here: it hides, docks or closes depending on where
   * the sidebar is mounted, and "Toggle sidebar" said none of those. */
  toggleLabel: string;
}) {
  // The page under an open Settings dialog, not the dialog's URL: Settings
  // opened from the Chat keeps the Chat lit and the chat sidebar in place.
  const pathname = useUnderlyingPathname();
  const { openFind } = useShell();
  const [toggleHovered, setToggleHovered] = useState(false);

  const assistantsNav = navItem("assistants");
  // What watches the Assistants rather than configures them, under its own
  // caption below the daily destinations.
  const OBSERVABILITY: NavId[] = ["improvements", "insights", "eval"];
  const primaryNav = GLOBAL_NAV.filter(
    (item) => !item.bottom && item.id !== "assistants" && !OBSERVABILITY.includes(item.id)
  );
  const observabilityNav = GLOBAL_NAV.filter((item) => OBSERVABILITY.includes(item.id));
  const alertsNav = navItem("alerts");
  const settingsNav = navItem("settings");

  // Chat swaps the console's navigation for the Teammates roster and history
  // (see `ChatSidebarSlotHost`); Home, Find and the account row stay put.
  const chatMode = isChatPath(pathname);

  const scopedId = assistantIdFromPath(pathname);
  const currentSetup = scopedId
    ? assistantSectionFromPath(pathname)
    : pathname.startsWith("/setup/")
      ? pathname.slice("/setup/".length)
      : null;

  const toggleButton = (
    <Hint label={toggleLabel} side="right">
      <CieleButton variant="ghost" size="icon-sm"
        type="button"
        aria-label={toggleLabel}
        aria-expanded={!collapsed}
        onClick={onToggle}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setToggleHovered(true);
        }}
        onPointerLeave={() => setToggleHovered(false)}
        className="press-control text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors"
      >
        <SidebarToggleIcon isOpen={toggleHovered ? collapsed : !collapsed} className="size-4" />
      </CieleButton>
    </Hint>
  );

  // Expanded: the icon-only Find sits beside the toggle, in the org row. The
  // rail keeps its own bordered one below the avatar; a 60px column has no row
  // to share.
  const findIconButton = (
    <Hint label="Find… (F)" side="bottom">
      <CieleButton variant="ghost" size="icon-sm"
        type="button"
        aria-label="Find"
        aria-keyshortcuts="F Meta+K"
        onClick={openFind}
            onPointerEnter={prefetchFind}
            onFocus={prefetchFind}
        className="press-control text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors"
      >
        <AnimatedIcon icon={Search} size={16} />
      </CieleButton>
    </Hint>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* Org identity (Vercel's organization row). Collapsed rail leads
          with the toggle button so it's the very first control in the
          sidebar. */}
      <div
        // `items-center` matters on the rail: the column is 60px wide and
        // every row below is a 36px box centred in it, so a header whose
        // children merely start after `px-2` sat 4px to the left of the whole
        // nav. Every control in the rail now shares one vertical axis.
        // Expanded, the row sits on the frame beside the workspace panel and
        // lines up with the top bar inside it: the panel is inset by `p-2`,
        // so the row is that inset taller than the bar's `h-14`.
        className={`flex items-center ${
          collapsed
            ? // The rail's header is the expanded one's height (`h-16 pt-2`,
              // the workspace panel's inset plus the top bar's `h-14`), so
              // the rule under it continues the top bar's bottom border.
              "h-16 shrink-0 flex-col justify-center px-2 pt-2"
            : "h-16 shrink-0 gap-2.5 px-4 pt-2"
        }`}
      >
        {/* On the icon rail the Organization's avatar is the whole header:
            Find and the widen control move into the top bar, beside the
            page they act on, exactly where they sit when the sidebar is
            hidden. */}
        {collapsed ? (
          <>
            <OrgAvatarSwitcher
              orgId={orgId}
              orgName={orgName}
              orgLogoUrl={orgLogoUrl}
              organizations={organizations}
              role={role}
              demo={demo}
              collapsed={collapsed}
            />
          </>
        ) : (
          <>
            <OrgAvatarSwitcher
              orgId={orgId}
              orgName={orgName}
              orgLogoUrl={orgLogoUrl}
              organizations={organizations}
              role={role}
              demo={demo}
              collapsed={collapsed}
            />
            {findIconButton}
            {toggleButton}
          </>
        )}
      </div>

      <QuickLinks
        pathname={pathname}
        collapsed={collapsed}
        settingsHref={canManageMembers(role) ? SETTINGS_HOME : PERSONAL_SETTINGS_HOME}
      />

      {/* On the icon rail Find lives in the top bar with the expand control;
          expanded, it is the icon beside the toggle above. */}
      {chatMode ? (
        <ChatSidebarSlotHost collapsed={collapsed} />
      ) : (
      <nav
        aria-label="Main navigation"
        data-foley-scroll=""
        className={`no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 ${
          collapsed ? "px-2" : "px-3 pt-3"
        }`}
      >
        <HoverHighlight>

        <NavSection label="Workspace" collapsed={collapsed} first>
          {/* The SETUP sections belong to an Assistant, so they hang off the
              row that *is* the Assistant: Overview when one is in scope, the
              dashboard entry when none is. They used to be a group of their
              own below a separator, which said nothing about whose sections
              they were and left the editor rail floating between the console
              pages and the org ones.

              Unscoped they still lead to `/setup/<section>`, the "choose an
              assistant to continue" picker, exactly as the flat group did. */}
          <NavFoldGroup
            name="setup"
            label="assistant sections"
            collapsed={collapsed}
            row={
              scopedId ? (
                <NavRow
                  key="overview"
                  icon={Bot}
                  label="Overview"
                  href={`/assistants/${scopedId}`}
                  collapsed={collapsed}
                  // On the rail the sections are not drawn, so the row they
                  // hang off is the one that says you are inside them.
                  active={
                    collapsed
                      ? pathname.startsWith(`/assistants/${scopedId}`)
                      : pathname === `/assistants/${scopedId}` &&
                        (!currentSetup || currentSetup === "overview")
                  }
                />
              ) : (
                assistantsNav && (
                  <NavRow
                    key={assistantsNav.label}
                    icon={assistantsNav.icon}
                    label={assistantsNav.label}
                    href={assistantsNav.href}
                    collapsed={collapsed}
                    active={navItemActive(assistantsNav, pathname)}
                  />
                )
              )
            }
            items={SETUP_SECTIONS.map((section) => ({
              label: section.label,
              href: setupHref(scopedId, section.slug),
              icon: section.icon,
            }))}
            activeIndex={SETUP_SECTIONS.findIndex(
              (section) => section.slug === currentSetup
            )}
          />
          {primaryNav.map((item) => (
            <NavRow
              key={item.label}
              icon={item.icon}
              label={item.label}
              href={item.href}
              collapsed={collapsed}
              active={navItemActive(item, pathname)}
              // Groups where somebody named you (#778). One per group, so the
              // number is how many rooms are waiting, not how many times you
              // were named in them.
              badge={item.id === "teammates" ? mentionCount : 0}
            />
          ))}
        </NavSection>

        {/* Improvements, Insights and Eval: how the Assistants are doing. */}
        <NavSection label="Observability" collapsed={collapsed}>
          {observabilityNav.map((item) => (
            <NavRow
              key={item.label}
              icon={item.icon}
              label={item.label}
              href={item.href}
              collapsed={collapsed}
              active={navItemActive(item, pathname)}
            />
          ))}
        </NavSection>

        {/* What is not a daily destination sits under its own caption. */}
        <NavSection label="Options" collapsed={collapsed}>
          {alertsNav && (
            <NavRow
              icon={alertsNav.icon}
              label={alertsNav.label}
              href={alertsNav.href}
              collapsed={collapsed}
              active={navItemActive(alertsNav, pathname)}
              badge={alertCount}
            />
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Support"
                  data-highlight-row
                  className={`${rowClass(collapsed)} ${ROW_IDLE}`}
                />
              }
            >
              <AnimatedIcon icon={LifeBuoy} size={16} className="shrink-0" />
              {!collapsed && <span className="truncate">Support</span>}
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-52">
              {SUPPORT_LINKS.map((link) =>
                "href" in link && link.href ? (
                  <DropdownMenuItem
                    key={link.label}
                    render={
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                      />
                    }
                  >
                    <link.icon className="size-4" /> {link.label}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem key={link.label} disabled>
                    <link.icon className="size-4" /> {link.label}
                    <span className="text-muted-foreground ml-auto text-xs">
                      Soon
                    </span>
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Settings opens the org-settings dialog, so the entry only exists
              for roles that can change something in it (owner / admin).
              Everyone else reaches their personal settings, Profile and
              theme, from the account menu below. */}
          {settingsNav && canManageMembers(role) && (
            <NavFoldGroup
              name="settings"
              label="settings sections"
              collapsed={collapsed}
              row={
                <NavRow
                  icon={settingsNav.icon}
                  label={settingsNav.label}
                  href={settingsNav.href}
                  collapsed={collapsed}
                  active={navItemActive(settingsNav, pathname)}
                />
              }
              items={SIDEBAR_SETTINGS_ITEMS.map((tab) => ({
                label: tab.label,
                href: tab.href,
                icon: tab.icon,
              }))}
              activeIndex={sidebarSettingsActiveIndex(pathname)}
            />
          )}
        </NavSection>
        </HoverHighlight>
      </nav>
      )}

      <NewChatButton collapsed={collapsed} account={{ profile, email, role: role ?? null, demo }} />

    </div>
  );
}

/** The platform and component library share the sidebar's interaction frame. */
export function AppSidebar(props: AppSidebarProps) {
  const {
    sidebarDocked, setSidebarDocked, sidebarWidth, setSidebarWidth,
    navDrawerOpen, setNavDrawerOpen,
  } = useShell();

  return (
    <SidebarFrame
      desktopClassName="desktop-sidebar"
      mobileNavigation={<MobileNavigation {...props} />}
      docked={sidebarDocked}
      setDocked={setSidebarDocked}
      width={sidebarWidth}
      setWidth={setSidebarWidth}
      drawerOpen={navDrawerOpen}
      setDrawerOpen={setNavDrawerOpen}
      renderContent={(options) => <SidebarContent {...props} {...options} />}
    />
  );
}
