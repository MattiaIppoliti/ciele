"use client";

import { prefetchFind } from "@/lib/find-client";
import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Organization, Profile, Role } from "@agent-hub/core";
import { ChevronsUpDown, LifeBuoy, MessageCircle, Search, Settings, type LucideIcon } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ResizeHandle, SHELL_GAP } from "@/components/ui/resizable-panel";
import { useModalFocus } from "@/components/motion/use-modal-focus";
import {
  DEFAULT_WIDTH,
  ICON_ONLY_AT,
  MAX_WIDTH,
  RAIL_WIDTH,
  isRailWidth,
  sidebarDragFor,
  sidebarReleaseFor,
} from "@/components/shell/sidebar-drag";
import { SPRING_PANEL, SPRING_REFOLD, SPRING_UNFOLD } from "@/lib/ease";
import { grabOffsetFor } from "@agent-hub/ui/resize-geometry";
import { haptic, playFeedback } from "@agent-hub/ui/feedback";
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
  useShellAssistants,
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
  avatarUrl,
  label,
  href,
  active,
  badge = 0,
  collapsed,
}: {
  icon?: LucideIcon;
  /** Renders the assistant's circular logo instead of `icon`, used for the
   * scoped assistant's "Overview" row when the assistant has an image. */
  avatarUrl?: string;
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
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="size-4 shrink-0 rounded-full object-cover"
          />
        ) : localGlyph ? (
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
      <PopoverContent align="start" className="w-72 p-0">
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
        <HoverHighlight className="max-h-72 overflow-y-auto overscroll-contain p-1.5">
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
                    <Link
                      href="/settings/members"
                      aria-label="Manage members"
                      onClick={() => setOpen(false)}
                      className="press-control text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-md transition-colors"
                    >
                      <AnimatedIcon icon={Settings} size={14} />
                    </Link>
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
  { label: "Product Roadmap", icon: MapIcon },
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
  const assistants = useShellAssistants();
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
  const scopedAssistant = scopedId
    ? assistants.find((assistant) => assistant.id === scopedId)
    : undefined;
  const currentSetup = scopedId
    ? assistantSectionFromPath(pathname)
    : pathname.startsWith("/setup/")
      ? pathname.slice("/setup/".length)
      : null;

  const toggleButton = (
    <Hint label={toggleLabel} side="right">
      <button
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
      </button>
    </Hint>
  );

  // Expanded: the icon-only Find sits beside the toggle, in the org row. The
  // rail keeps its own bordered one below the avatar; a 60px column has no row
  // to share.
  const findIconButton = (
    <Hint label="Find… (F)" side="bottom">
      <button
        type="button"
        aria-label="Find"
        aria-keyshortcuts="F Meta+K"
        onClick={openFind}
            onPointerEnter={prefetchFind}
            onFocus={prefetchFind}
        className="press-control text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors"
      >
        <AnimatedIcon icon={Search} size={16} />
      </button>
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
                  icon={MessageCircle}
                  avatarUrl={scopedAssistant?.avatarUrl ?? undefined}
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

/**
 * Off-canvas navigation for phones and portrait tablets, where a 240px
 * permanent sidebar would leave the page barely a third of the screen.
 *
 * It is the *same* `SidebarContent`, always in its full (labelled) form, a
 * collapsed icon rail is a pointing device's affordance, and there is no
 * hover to reveal what an icon means on touch. Opened from the top bar's
 * hamburger; closed by the backdrop, the toggle, Escape, or navigating
 * (`ShellProvider` closes it on every pathname change).
 */
function NavDrawer(props: AppSidebarProps) {
  const { navDrawerOpen, setNavDrawerOpen } = useShell();
  const reduceMotion = useReducedMotion();
  const drawerRef = useRef<HTMLDivElement>(null);

  useModalFocus(navDrawerOpen, drawerRef);

  useEffect(() => {
    if (!navDrawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setNavDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navDrawerOpen, setNavDrawerOpen]);

  return (
    // Leaves toward the edge it arrived from. Unmounting on `!navDrawerOpen`
    // took the drawer off screen in a single frame after a 200ms entrance, so
    // the mobile nav contradicted its own spatial story on every close.
    <AnimatePresence>
      {navDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <motion.button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavDrawerOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/50"
          />
          <motion.div
            ref={drawerRef}
            data-nav-drawer
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            // Past its own width plus the inset, or the last 8px and the
            // shadow would still show at the edge.
            initial={reduceMotion ? { opacity: 0 } : { x: "calc(-100% - 1rem)" }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: "calc(-100% - 1rem)" }}
            transition={SPRING_PANEL}
            // A floating rounded panel, inset like the workspace panel it
            // covers. viewport-fit=cover: the insets grow to keep the account
            // row off the home indicator and the rows out from under a notch.
            className="bg-background absolute top-[max(0.5rem,env(safe-area-inset-top))] bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-[max(0.5rem,env(safe-area-inset-left))] flex w-[17rem] max-w-[85vw] flex-col overflow-hidden rounded-xl border shadow-strong"
          >
            <SidebarContent
              {...props}
              collapsed={false}
              toggleLabel="Close navigation"
              onToggle={() => setNavDrawerOpen(false)}
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * Vercel-style shell sidebar with the previous rail's mechanics: drag the
 * right edge to resize, below ICON_ONLY_AT it collapses to an icon rail,
 * past HIDE_AT it hides entirely. While hidden, hovering the left screen
 * edge peeks a floating panel; the top bar shows a reopen button.
 *
 * All of that is desktop behaviour (`lg` and up). Below it the sidebar leaves
 * the layout entirely and navigation moves into `NavDrawer`, dragging a
 * resize handle and hovering a 6px screen edge are both mouse affordances,
 * and the space simply isn't there.
 */
export function AppSidebar(props: AppSidebarProps) {
  const {
    sidebarDocked,
    setSidebarDocked,
    sidebarWidth: width,
    setSidebarWidth: setWidth,
  } = useShell();
  const [peek, setPeek] = useState(false);
  const [dragging, setDragging] = useState(false);
  const reduceMotion = useReducedMotion();
  // Armed, not committed. Crossing HIDE_AT used to end the drag mid-gesture
  // and reset the width to the default, so a slip past the threshold was
  // unrecoverable *and* destroyed a width the user had chosen. Now it only
  // arms the outcome: dragging back disarms, and release decides.
  const [armedToHide, setArmedToHide] = useState(false);
  const grabOffsetRef = useRef(0);
  const widthBeforeDragRef = useRef(DEFAULT_WIDTH);
  const handleRef = useRef<HTMLElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  function startDrag(event: React.PointerEvent) {
    const handle = event.currentTarget as HTMLElement;
    const edge = handle.parentElement?.getBoundingClientRect().right ?? event.clientX;
    grabOffsetRef.current = grabOffsetFor(edge, event.clientX);
    widthBeforeDragRef.current = width;
    if (handle.setPointerCapture) {
      handle.setPointerCapture(event.pointerId);
      handleRef.current = handle;
      pointerIdRef.current = event.pointerId;
    }
    setArmedToHide(false);
    setDragging(true);
  }

  useEffect(() => {
    if (!dragging) return;
    const handle = handleRef.current;
    // Last few moves, so release velocity is a short average rather than the
    // single final delta, which is noisy enough to flip the outcome.
    const trail: { x: number; t: number }[] = [];
    const onMove = (e: PointerEvent) => {
      trail.push({ x: e.clientX, t: e.timeStamp });
      if (trail.length > 5) trail.shift();
      const next = sidebarDragFor(e.clientX, grabOffsetRef.current);
      setWidth(next.width);
      setArmedToHide(next.armedToHide);
    };
    const releaseVelocity = () => {
      if (trail.length < 2) return 0;
      const first = trail[0];
      const last = trail[trail.length - 1];
      const dt = last.t - first.t;
      return dt > 0 ? ((last.x - first.x) / dt) * 1000 : 0;
    };
    const endDrag = (e: PointerEvent) => {
      const release = sidebarReleaseFor(
        sidebarDragFor(e.clientX, grabOffsetRef.current),
        widthBeforeDragRef.current,
        releaseVelocity(),
      );
      setWidth(release.width);
      setSidebarDocked(release.docked);
      // The snap is the felt end of the drag (#817): rail <-> full, or hidden.
      // Same frame as the visual, same detent the bottom sheet uses.
      if (
        !release.docked ||
        isRailWidth(release.width) !== isRailWidth(widthBeforeDragRef.current)
      ) {
        playFeedback("tick");
        haptic("detent");
      }
      setArmedToHide(false);
      setDragging(false);
      const id = pointerIdRef.current;
      if (handle && id !== null && handle.hasPointerCapture?.(id)) {
        handle.releasePointerCapture(id);
      }
      handleRef.current = null;
      pointerIdRef.current = null;
    };
    // Capture keeps the drag alive across the main content and any iframe in
    // it (the live Preview), and gives us a pointercancel to clean up on.
    const target: EventTarget = handle ?? window;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    target.addEventListener("pointermove", onMove as EventListener);
    target.addEventListener("pointerup", endDrag as EventListener);
    target.addEventListener("pointercancel", endDrag as EventListener);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      target.removeEventListener("pointermove", onMove as EventListener);
      target.removeEventListener("pointerup", endDrag as EventListener);
      target.removeEventListener("pointercancel", endDrag as EventListener);
    };
  }, [dragging, setSidebarDocked, setWidth]);

  // Toggle = fully hide the sidebar (it leaves the layout entirely, not an
  // icon rail). The width is preserved on purpose: reopening restores the
  // exact state the sidebar had before closing, so a full sidebar reopens
  // full and one dragged down to the icon rail reopens as the rail.
  const close = () => setSidebarDocked(false);

  const collapsed = isRailWidth(width);

  return (
    <>
      {/* The docked sidebar's width is animated rather than transitioned,
          and it animates to and from zero, which is what makes closing and
          reopening read as a movement at all. It used to unmount on close and
          mount on open, so the main content jumped 240px in one frame; the
          CSS `transition-[width]` it carried only ever ran on the rail/full
          change, and 200ms of `ease-out` there was invisible anyway.

          `SPRING_UNFOLD` opens and `SPRING_REFOLD` closes: the opening is
          allowed its overshoot, because a panel arriving under its own
          momentum is the thing that makes the gesture legible, while a
          closing panel that overshot would pull the main content past the
          screen edge and back. Dragging animates nothing, or the width would
          chase the pointer a beat behind it. */}
      <AnimatePresence initial={false}>
        {sidebarDocked && (
          <motion.aside
            key="docked-sidebar"
            initial={{ width: 0 }}
            animate={{ width: collapsed ? RAIL_WIDTH : width }}
            exit={{
              width: 0,
              transition: reduceMotion ? { duration: 0 } : SPRING_REFOLD,
            }}
            transition={
              reduceMotion || dragging ? { duration: 0 } : SPRING_UNFOLD
            }
            // While armed, the panel dims toward the outcome instead of just
            // sitting there: the in-between frames should point at what
            // release will do, so "let go now and it closes" is legible
            // before it does.
            className={`relative hidden h-full shrink-0 flex-col md:flex ${
              armedToHide ? "opacity-45" : "opacity-100"
            }`}
          >
            {/* The clip belongs to the content, not to the panel. The resize
                grip hangs off the panel's own edge and is wider than the edge
                it centres on, so a panel that clipped its overflow cut the
                grip in half down the border. */}
            <div className="h-full overflow-hidden">
              {/* The content keeps the width it is animating to, so it slides
                  out from behind the edge instead of reflowing every row while
                  the panel opens. */}
              <div
                className="flex h-full flex-col"
                style={{ width: collapsed ? RAIL_WIDTH : width }}
              >
                <SidebarContent
                  {...props}
                  collapsed={collapsed}
                  toggleLabel="Hide sidebar"
                  // Toggle fully hides the sidebar (never a rail). Width is
                  // preserved so reopening from the top bar restores the same
                  // state, full or the dragged-down icon rail. Rail is reached
                  // only by dragging.
                  onToggle={close}
                />
              </div>
            </div>
            <ResizeHandle
              side="right"
              gap={SHELL_GAP}
              // The workspace panel's own extent (the layout's `md:p-2`), so
              // the lit line bends round its rounded corners.
              span="inset-y-2"
              cornered="right"
              label="Resize sidebar"
              resizing={dragging}
              onPointerDown={startDrag}
              value={collapsed ? RAIL_WIDTH : width}
              minValue={RAIL_WIDTH}
              maxValue={MAX_WIDTH}
              onValueChange={(nextWidth) =>
                setWidth(
                  collapsed &&
                    nextWidth > RAIL_WIDTH &&
                    nextWidth < ICON_ONLY_AT
                    ? ICON_ONLY_AT
                    : nextWidth,
                )
              }
            />
          </motion.aside>
        )}
      </AnimatePresence>

      {!sidebarDocked && (
        <UndockedSidebar
          {...props}
          peek={peek}
          setPeek={setPeek}
          onDock={() => setSidebarDocked(true)}
        />
      )}
      <NavDrawer {...props} />
    </>
  );
}

/**
 * What stands in for the sidebar while it is hidden: the hover zone along the
 * screen edge, and the floating panel that zone reveals.
 *
 * A module-level component, not one declared inside `AppSidebar`. A component
 * defined during render is a new type on every render, so React unmounts and
 * remounts its whole subtree; `setPeek` alone would have remounted this one
 * twice per hover, which is the one thing that breaks `AnimatePresence`: the
 * exit never plays, because by the time `peek` is false the presence that was
 * tracking the child is itself gone.
 */
function UndockedSidebar({
  peek,
  setPeek,
  onDock,
  ...props
}: AppSidebarProps & {
  peek: boolean;
  setPeek: (peek: boolean) => void;
  /** Toggling from the floating panel docks it, rather than hiding it again. */
  onDock: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <>
      {/* Hover zone along the screen edge that reveals the floating panel. */}
      <div
        className="fixed inset-y-0 left-0 z-40 hidden w-1.5 md:block"
        onMouseEnter={() => setPeek(true)}
      />
      {/* Enter and exit along the same path. This used to slide in from the
          left over 200ms and then vanish in a single frame when `peek` went
          false, which contradicts the spatial relationship the entrance had
          just established: a panel that came from the left edge should go back
          to it. AnimatePresence is what gives the unmount somewhere to go. */}
      <AnimatePresence>
        {peek && (
          <motion.div
            onMouseLeave={() => setPeek(false)}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -16 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -16 }}
            transition={SPRING_PANEL}
            // Exactly on the workspace panel's own inset and radius (the
            // layout's `md:p-2`, `rounded-xl`), so its top, left and bottom
            // edges and its corners land on the panel's: one box, not a
            // second one offset a few pixels inside the first.
            className="bg-background fixed top-2 bottom-2 left-2 z-50 hidden w-64 flex-col overflow-hidden rounded-xl border shadow-strong md:flex"
          >
            <SidebarContent
              {...props}
              collapsed={false}
              toggleLabel="Dock sidebar"
              onToggle={() => {
                setPeek(false);
                onDock();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
