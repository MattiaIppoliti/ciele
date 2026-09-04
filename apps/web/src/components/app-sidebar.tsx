"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Organization, Profile, Role } from "@agent-hub/core";
import {
  BookOpen,
  Check,
  ChevronsUpDown,
  Ellipsis,
  Fingerprint,
  LifeBuoy,
  LogOut,
  Map as MapIcon,
  MessageCircle,
  MessageCircleQuestion,
  Search,
  Settings,
  Ticket,
  type LucideIcon,
} from "lucide-react";
// Icon data, not components: the collapse arrow reshapes between the two.
import {
  PanelLeftClose as PanelLeftCloseData,
  PanelLeftOpen as PanelLeftOpenData,
} from "lucide";
import { MorphIcon } from "morphicons/react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { signOutAction, switchOrganizationAction } from "@/app/actions";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { SoundSwitcher } from "@/components/sound-switcher";
import { Badge } from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@agent-hub/ui";
import { HoverHighlight } from "@/components/ui/hover-highlight";
import { Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ResizeHandle } from "@/components/ui/resizable-panel";
import {
  DEFAULT_WIDTH,
  RAIL_WIDTH,
  isRailWidth,
  sidebarDragFor,
  sidebarReleaseFor,
} from "@/components/shell/sidebar-drag";
import { SPRING_PANEL } from "@/lib/ease";
import { grabOffsetFor } from "@agent-hub/ui/resize-geometry";
import { haptic, playFeedback } from "@agent-hub/ui/feedback";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  GLOBAL_NAV,
  SETUP_SECTIONS,
  assistantIdFromPath,
  assistantSectionFromPath,
  setupHref,
} from "@/components/shell/nav";
import {
  useShell,
  useShellAssistants,
} from "@/components/shell/shell-provider";
import { canManageMembers } from "@/lib/rbac";

/** Full name if set, else username, else the email local-part. */
function profileDisplayName(profile: Profile | null, email: string): string {
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  return fullName || profile?.username || email.split("@")[0] || email;
}


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

// Hover feedback comes from the shared HoverHighlight pill that slides
// between rows, so idle rows only shift text color on hover.
const ROW_IDLE = "text-muted-foreground hover:text-foreground";
const ROW_ACTIVE = "bg-muted text-foreground";

function rowClass(collapsed: boolean) {
  return `press relative flex h-8 items-center rounded-lg text-sm font-medium transition-colors ${
    collapsed ? "w-9 justify-center self-center" : "w-full gap-2.5 px-2.5"
  }`;
}

/**
 * Pending state for the row the user just clicked.
 *
 * Server navigation in this app can take a beat, and until now the click was
 * unacknowledged: `loading.tsx` only appears once the router commits, and the
 * row itself never changed. That gap is the dead-click case, the one thing
 * response feedback exists to prevent.
 *
 * `useLinkStatus` has to be called from inside the <Link>, which is why this is
 * its own component rather than a flag on NavRow.
 */
function NavRowPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="bg-foreground/50 absolute inset-y-1 left-0 w-0.5 animate-pulse rounded-full"
    />
  );
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
  const row = (
    <Link
      href={href}
      aria-label={label}
      data-highlight-row
      className={`${rowClass(collapsed)} ${active ? ROW_ACTIVE : ROW_IDLE}`}
    >
      <span className="relative block shrink-0">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="size-4 shrink-0 rounded-full object-cover"
          />
        ) : Icon ? (
          <AnimatedIcon icon={Icon} size={16} className="shrink-0" />
        ) : null}
        {badge > 0 && collapsed && (
          <span className="absolute -top-1 -right-1 size-2 rounded-full bg-red-500" />
        )}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
      {badge > 0 && !collapsed && (
        <span className="ml-auto rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">
          {badge}
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
              : "press hover:bg-muted -mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors"
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
          <Badge variant="secondary" className="shrink-0 capitalize">
            {roleLabel}
          </Badge>
          <AnimatedIcon
            icon={ChevronsUpDown}
            size={14}
            iconClassName="text-muted-foreground"
            className="shrink-0"
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
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find Organization..."
            className="placeholder:text-muted-foreground h-10 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <HoverHighlight className="max-h-72 overflow-y-auto p-1.5">
          {filtered.map((org) => {
            const active = org.id === orgId;
            return (
              <div
                key={org.id}
                data-highlight-row
                className="relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm"
              >
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => switchTo(org.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:opacity-50"
                >
                  <OrgAvatar name={org.name} logoUrl={org.logoUrl} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {org.name}
                  </span>
                </button>
                {active && (
                  <>
                    <Badge variant="secondary" className="shrink-0 capitalize">
                      {roleLabel}
                    </Badge>
                    <Check className="size-4 shrink-0" />
                  </>
                )}
                {active && canManage && (
                  <Hint label="Manage members">
                    <Link
                      href="/settings/members"
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
  expandsOnToggle,
}: AppSidebarProps & {
  collapsed: boolean;
  onToggle: () => void;
  /** True when the toggle grows the sidebar (rail → full, or peek → docked),
   * so it shows the "open" glyph; false when it shrinks (full → rail). */
  expandsOnToggle: boolean;
}) {
  const pathname = usePathname();
  const { openFind } = useShell();
  const assistants = useShellAssistants();

  const assistantsNav = GLOBAL_NAV.find((item) => item.label === "Assistants");
  const primaryNav = GLOBAL_NAV.filter(
    (item) => !item.bottom && item.label !== "Assistants"
  );
  const alertsNav = GLOBAL_NAV.find((item) => item.label === "Alerts");
  const settingsNav = GLOBAL_NAV.find((item) => item.label === "Settings");

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
    <Hint label="Toggle sidebar" side="right">
      <button
        type="button"
        aria-label="Toggle sidebar"
        onClick={onToggle}
        className="press-control text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors"
      >
        {/* The arrow reverses by reshaping, not by swapping one glyph for
            the other (morphicons.com), so the direction the sidebar is about
            to move is legible mid-animation. */}
        <MorphIcon
          icon={expandsOnToggle ? PanelLeftOpenData : PanelLeftCloseData}
          size={16}
        />
      </button>
    </Hint>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* Org identity (Vercel's organization row). Collapsed rail leads
          with the toggle button so it's the very first control in the
          sidebar. */}
      <div
        className={`flex items-center pt-4 pb-3 ${
          collapsed ? "flex-col gap-2 px-2" : "gap-2.5 px-4"
        }`}
      >
        {collapsed ? (
          <>
            {toggleButton}
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
            {toggleButton}
          </>
        )}
      </div>

      {/* Find... opens the command palette (F / Cmd+K). */}
      <div className={`pb-2 ${collapsed ? "flex justify-center px-2" : "px-3"}`}>
        {collapsed ? (
          <Hint label="Find... (F)" side="right">
            <button
              type="button"
              aria-label="Find"
              onClick={openFind}
              className="press-control border-input text-muted-foreground hover:bg-muted flex size-9 items-center justify-center rounded-lg border transition-colors"
            >
              <AnimatedIcon icon={Search} size={16} />
            </button>
          </Hint>
        ) : (
          <button
            type="button"
            onClick={openFind}
            className="press border-input text-muted-foreground hover:bg-muted flex h-8 w-full items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors"
          >
            <AnimatedIcon icon={Search} size={16} className="shrink-0" />
            <span className="flex-1 truncate text-left">Find...</span>
            <kbd className="rounded-md border px-1.5 font-sans text-xs">F</kbd>
          </button>
        )}
      </div>

      <nav
        className={`no-scrollbar min-h-0 flex-1 overflow-y-auto pb-3 ${
          collapsed ? "px-2" : "px-3"
        }`}
      >
        <HoverHighlight>
        <div className="bg-border mb-3 h-px" />

        <div className="flex flex-col items-center gap-0.5">
          {scopedId ? (
            <NavRow
              key="overview"
              icon={MessageCircle}
              avatarUrl={scopedAssistant?.avatarUrl ?? undefined}
              label="Overview"
              href={`/assistants/${scopedId}`}
              collapsed={collapsed}
              active={
                pathname === `/assistants/${scopedId}` &&
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
                active={pathname === assistantsNav.href}
              />
            )
          )}
          {primaryNav.map((item) => (
            <NavRow
              key={item.label}
              icon={item.icon}
              label={item.label}
              href={item.href}
              collapsed={collapsed}
              active={
                item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.match ?? item.href)
              }
              // Groups where somebody named you (#778). One per group, so the
              // number is how many rooms are waiting, not how many times you
              // were named in them.
              badge={item.label === "Teammates" ? mentionCount : 0}
            />
          ))}
        </div>

        <div className="bg-border my-3 h-px" />

        <div className="flex flex-col items-center gap-0.5">
          {SETUP_SECTIONS.map((section) => (
              <NavRow
                key={section.slug}
                icon={section.icon}
                label={section.label}
                href={setupHref(scopedId, section.slug)}
                active={currentSetup === section.slug}
                collapsed={collapsed}
              />
          ))}
        </div>

        <div className="bg-border my-3 h-px" />

        <div className="flex flex-col items-center gap-0.5">
          {alertsNav && (
            <NavRow
              icon={alertsNav.icon}
              label={alertsNav.label}
              href={alertsNav.href}
              collapsed={collapsed}
              active={pathname.startsWith(alertsNav.match ?? alertsNav.href)}
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
            <NavRow
              icon={settingsNav.icon}
              label={settingsNav.label}
              href={settingsNav.href}
              collapsed={collapsed}
              active={pathname.startsWith(settingsNav.match ?? settingsNav.href)}
            />
          )}
        </div>
        </HoverHighlight>
      </nav>

      {/* Account row (Vercel's bottom-left user block), the caller's own
          identity, not the org's (the org already has its own switcher
          above). */}
      <div
        className={`flex items-center border-t py-3 ${
          collapsed ? "justify-center px-2" : "gap-2.5 px-4"
        }`}
      >
        {!collapsed && (
          <>
            <UserAvatar
              avatarUrl={profile?.avatarUrl}
              userId={profile?.userId}
              email={email}
              size="size-8"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {profileDisplayName(profile, email)}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                {demo ? "Demo mode" : email}
              </span>
            </span>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              collapsed ? (
                <button
                  type="button"
                  aria-label="Account menu"
                  className="rounded-full transition-shadow hover:ring-2 hover:ring-black/10"
                />
              ) : (
                <button
                  type="button"
                  aria-label="Account menu"
                  className="press-control text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors"
                />
              )
            }
          >
            {collapsed ? (
              <UserAvatar
                avatarUrl={profile?.avatarUrl}
                userId={profile?.userId}
                email={email}
                size="size-9"
              />
            ) : (
              <Ellipsis className="size-4" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={collapsed ? "right" : "top"}
            align="end"
            className="w-60"
          >
            <DropdownMenuLabel>
              <p className="truncate font-semibold">{profileDisplayName(profile, email)}</p>
              <p className="text-muted-foreground truncate text-xs font-normal">
                {demo ? "Demo mode, no login" : email}
                {role ? ` · ${role}` : ""}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* Org-level settings live in the sidebar's Settings dialog, the
                account menu only carries personal items, which is also how a
                non-admin reaches their own profile at all. */}
            <DropdownMenuItem render={<Link href="/settings/profile" />}>
              <AnimatedIcon icon={Fingerprint} size={16} /> Profile
            </DropdownMenuItem>
            {/* No cookie-preferences entry: the console sets no non-essential
                cookies and shows no banner (components/cookie-consent/
                cookie-consent.tsx), so there is nothing here to withdraw.
                Consent belongs to the public site, where the trackers are. */}
            <DropdownMenuSeparator />
            <ThemeSwitcher />
            <SoundSwitcher />
            {!demo && (
              <DropdownMenuItem onClick={() => signOutAction()}>
                <LogOut className="size-4" /> Sign out
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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

  useEffect(() => {
    if (!navDrawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavDrawerOpen(false);
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
        <div className="fixed inset-0 z-50 lg:hidden">
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
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            initial={reduceMotion ? { opacity: 0 } : { x: "-100%" }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: "-100%" }}
            transition={SPRING_PANEL}
            className="bg-background absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col border-r shadow-2xl"
          >
            <SidebarContent
              {...props}
              collapsed={false}
              expandsOnToggle={false}
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
  const { sidebarDocked, setSidebarDocked } = useShell();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
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
  }, [dragging, setSidebarDocked]);

  // Toggle = fully hide the sidebar (it leaves the layout entirely, not an
  // icon rail). The width is preserved on purpose: reopening restores the
  // exact state the sidebar had before closing, so a full sidebar reopens
  // full and one dragged down to the icon rail reopens as the rail.
  const close = () => setSidebarDocked(false);

  if (sidebarDocked) {
    const collapsed = isRailWidth(width);
    return (
      <>
        <aside
          style={{ width: collapsed ? RAIL_WIDTH : width }}
          // While armed, the panel dims toward the outcome instead of just
          // sitting there: the in-between frames should point at what release
          // will do, so "let go now and it closes" is legible before it does.
          className={`bg-background relative hidden h-full shrink-0 flex-col border-r lg:flex ${
            dragging ? "" : "transition-[width] duration-200 ease-out"
          } ${armedToHide ? "opacity-45" : "opacity-100"}`}
        >
          <SidebarContent
            {...props}
            collapsed={collapsed}
            expandsOnToggle={false}
            // Toggle fully hides the sidebar (never a rail). Width is preserved
            // so reopening from the top bar restores the same state, full or
            // the dragged-down icon rail. Rail is reached only by dragging.
            onToggle={close}
          />
          <ResizeHandle
            side="right"
            label="Resize sidebar"
            resizing={dragging}
            onPointerDown={startDrag}
          />
        </aside>
        <NavDrawer {...props} />
      </>
    );
  }

  return (
    <>
      {/* Hover zone along the screen edge that reveals the floating panel. */}
      <div
        className="fixed inset-y-0 left-0 z-40 hidden w-1.5 lg:block"
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
            className="bg-background fixed top-3 bottom-3 left-3 z-50 hidden w-64 flex-col overflow-hidden rounded-xl border shadow-2xl lg:flex"
          >
            <SidebarContent
              {...props}
              collapsed={false}
              expandsOnToggle
              onToggle={() => {
                setPeek(false);
                setSidebarDocked(true);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <NavDrawer {...props} />
    </>
  );
}
