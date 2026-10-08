"use client";

import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import type { Profile, Role } from "@agent-hub/core";
import { ArrowUpRight, Fingerprint, House, LogOut, Settings, X, type LucideIcon } from "lucide-react";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { Button, Hint } from "@agent-hub/ui";
import { signOutAction } from "@/app/actions";
import { CieleAiPeek } from "@/components/teammates/ciele-ai-logo";
import { useShell } from "@/components/shell/shell-provider";
import { ROW_IDLE } from "@/components/shell/sidebar-row";
import { SoundSwitcher } from "@/components/sound-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { AnimatedGlyph, AnimatedIcon } from "@/components/ui/animated-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageCircleIcon } from "@/components/ui/icons/message-circle";
import { UserRoundCogIcon } from "@/components/ui/icons/user-round-cog";
import { SPRING_LAYOUT } from "@/lib/ease";
import { chatSession } from "@/lib/chat-session";
import { navItem, navItemActive } from "@/components/shell/nav";

/**
 * The sidebar's Chat-mode controls, apart from the console nav they sit
 * beside: the Home / Chat / Settings top row, New chat with the profile menu at
 * the foot, and the slot the Teammates layout portals its panel into. They
 * change for the Chat surface's reasons, the rest of `app-sidebar.tsx` for the
 * console nav's.
 */

/** Chat is the Teammates surface; on it the sidebar swaps the nav for its panel. */
export const isChatPath = (pathname: string) => navItemActive(navItem("teammates"), pathname);


/** Full name if set, else username, else the email local-part. */
function profileDisplayName(profile: Profile | null, email: string): string {
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ");
  return fullName || profile?.username || email.split("@")[0] || email;
}

/**
 * Home, Chat and Settings, the sidebar's top row (Notion's). The active one is
 * a labelled pill and the others stay icon-only, so the row reads as "where
 * you are" at a glance. Chat is the Teammates surface, the console's
 * one place a Member talks to an AI colleague.
 *
 * Settings opens the Settings dialog, and its `href` is per Member:
 * organization settings for whoever may change them, personal settings for
 * everyone else.
 */
const QUICK_LINKS: ({
  label: string;
  /** Absent for Settings, whose destination `QuickLinks` is given per Member. */
  href?: string;
  isActive: (pathname: string) => boolean;
} & (
  | { icon: LucideIcon; glyph?: never }
  // or a local animated glyph (`ui/icons/`)
  | { glyph: typeof MessageCircleIcon; icon?: never }
))[] = [
  {
    // Everything that is neither the Chat nor Settings is Home's: the console
    // is the home, so its pages keep Home lit, labelled, as "you are in here".
    label: "Home",
    href: "/",
    icon: House,
    isActive: (pathname) => !isChatPath(pathname) && !pathname.startsWith("/settings"),
  },
  {
    label: "Chat",
    href: "/teammates",
    glyph: MessageCircleIcon,
    isActive: isChatPath,
  },
  {
    // The Settings dialog, straight from the top row. Its `href` is
    // `QuickLinks`'s `settingsHref`: organization settings for whoever may
    // change them, personal settings for everyone else.
    label: "Settings",
    icon: Settings,
    isActive: (pathname) => pathname.startsWith("/settings"),
  },
];

// Lighter than ROW_ACTIVE's `bg-muted` on purpose: this pill is the row's only
// state marker, so it has to read against the sidebar at a glance.
const QUICK_PILL = "bg-foreground/15 ring-1 ring-foreground/10";

export function QuickLinks({
  pathname,
  collapsed,
  settingsHref,
}: {
  pathname: string;
  collapsed: boolean;
  settingsHref: string;
}) {
  const reduce = useReducedMotion();
  // The sidebar can be mounted twice (docked and in the drawer), and two pills
  // sharing a layoutId would glide between the two mounts.
  const pillId = `quick-link-pill-${useId()}`;
  return (
    // The same glide as the Library tabs: one pill under a shared layoutId,
    // on the console's shared-layout spring. The row lives in the sidebar,
    // which survives navigation, so both positions exist in one commit.
    <MotionConfig transition={reduce ? { duration: 0 } : SPRING_LAYOUT}>
      <div
        className={`flex gap-1 pb-2 ${collapsed ? "flex-col items-center px-2" : "items-center px-3"}`}
      >
        {QUICK_LINKS.map(({ label, href: baseHref, icon, glyph, isActive }) => {
          const href = baseHref ?? settingsHref;
          const active = isActive(pathname);
          const showLabel = active && !collapsed;
          return (
            // `position` only: scaling the row would squash its text, so the
            // row slides and the pill alone animates its size.
            <motion.div key={label} layout="position">
              <Hint label={label} side={collapsed ? "right" : "bottom"}>
                <Link
                  href={href}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className={`press-control relative flex h-8 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors ${
                    showLabel ? "px-3" : "w-9"
                  } ${active ? "text-foreground" : `${ROW_IDLE} hover:bg-muted`}`}
                >
                  {active && (
                    <motion.span
                      aria-hidden
                      layoutId={pillId}
                      style={{ borderRadius: 9999 }}
                      className={`absolute inset-0 ${QUICK_PILL}`}
                    />
                  )}
                  {glyph ? (
                    <AnimatedGlyph icon={glyph} size={16} className="relative shrink-0" />
                  ) : (
                    icon && <AnimatedIcon icon={icon} size={16} className="relative shrink-0" />
                  )}
                  {showLabel && (
                    <motion.span
                      className="relative"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={reduce ? { duration: 0 } : { duration: 0.2, delay: 0.05 }}
                    >
                      {label}
                    </motion.span>
                  )}
                </Link>
              </Hint>
            </motion.div>
          );
        })}
      </div>
    </MotionConfig>
  );
}

/** The platform never changes under a page, so there is nothing to subscribe to. */
const noSubscription = () => () => {};

/**
 * New chat, at the foot of the sidebar in Home and in Chat alike: a fresh
 * conversation with Ciele AI, which peeks up from the button's bottom edge.
 * A link to the bare `/teammates`, and the chat reads the URL, so from inside
 * an open thread the same click also resets it.
 */
export function NewChatButton({
  collapsed,
  account,
}: {
  collapsed: boolean;
  account: { profile: Profile | null; email: string; role: Role | null; demo: boolean };
}) {
  // The chord as this platform spells it. The server renders the Mac spelling
  // (it cannot know), and the client corrects it without a hydration mismatch.
  const chord = useSyncExternalStore(
    noSubscription,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘O" : "Ctrl O"),
    () => "⌘O"
  );
  const link = (
    <Button variant="secondary" size={collapsed ? "icon-sm" : "sm"}
      render={<Link href="/teammates" />}
      // The URL alone misses a first message that has no `?c=` yet.
      onClick={chatSession.requestNewChat}
      aria-label="New chat"
      aria-keyshortcuts="Meta+O Control+O"
      icon={<CieleAiPeek className="size-full" />}
      className={collapsed ? "@container" : "@container min-w-0 flex-1"}
    >
        {!collapsed && (
          <span className="flex min-w-0 items-center gap-2">
            <span className="whitespace-nowrap">New chat</span>
            {/* Quieter than the label: the shortcut is a hint, not the action.
                Shown only while the button is wide enough for the label, the
                mark and the chip on one line (a container query on the
                button's own width, which the sidebar's drag sets); narrower,
                it goes before the label would wrap. The chord stays on the
                link (`aria-keyshortcuts`), and in the rail's tooltip. */}
            <kbd className="border-foreground/10 text-muted-foreground/55 hidden rounded-md border px-1.5 font-sans text-2xs leading-5 whitespace-nowrap @[9rem]:inline-block">
              {chord}
            </kbd>
          </span>
        )}
    </Button>
  );
  return (
    <div
      className={`flex items-center justify-center gap-2 pt-1 pb-3 ${
        collapsed ? "flex-col px-2" : "px-3"
      }`}
    >
      {/* Only the icon rail gets a tooltip: `Hint` wraps its trigger in a
          span, and expanded that span, not the link, would be the flex item,
          so the link's `flex-1` would stop filling the row. */}
      {collapsed ? (
        <Hint label={`New chat (${chord})`} side="right">
          {link}
        </Hint>
      ) : (
        link
      )}
      <ProfileQuickMenu {...account} collapsed={collapsed} />
    </div>
  );
}

/**
 * The round button beside New chat (Notion's): a chevron that turns into an X
 * while open, over who is signed in, profile, theme, sounds and Sign out. It
 * replaced the account row at the foot of the sidebar, which carried the same. Organization
 * settings stay in the top row and the account row keeps Sign out.
 */
function ProfileQuickMenu({
  profile,
  email,
  role,
  demo,
  collapsed,
}: {
  profile: Profile | null;
  email: string;
  role: Role | null;
  demo: boolean;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* The tooltip names it (Notion's "New…"); it stays quiet while the
          menu it would describe is already open. */}
      <Hint label={open ? "Close" : "Preferences…"} side="top">
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={open ? "Close preferences" : "Profile and preferences"}
            // Grows a touch on hover, like New chat beside it; the transition
            // is inline because `.press` is unlayered and would win.
            style={{
              transition:
                "scale 200ms cubic-bezier(0, 0, 0.2, 1), transform 100ms cubic-bezier(0, 0, 0.2, 1), color 150ms, background-color 150ms",
            }}
            className="press border-foreground/10 bg-foreground/[0.07] text-muted-foreground hover:bg-foreground/[0.14] hover:text-foreground motion-safe:hover:scale-[1.06] flex size-9 shrink-0 items-center justify-center rounded-full border"
          />
        }
      >
        {/* The user-and-cog, swapped for the X that closes it while open. A
            crossfade rather than a morph: it is a local animated glyph, which
            morphicons cannot reshape. */}
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={open ? "close" : "open"}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="flex"
          >
            {open ? <X aria-hidden className="size-[18px]" /> : <AnimatedGlyph icon={UserRoundCogIcon} size={18} />}
          </motion.span>
        </AnimatePresence>
      </DropdownMenuTrigger>
      </Hint>
      {/* Notion's creation menu: a roomier panel, larger rows. */}
      <DropdownMenuContent
        side={collapsed ? "right" : "top"}
        align="end"
        sideOffset={8}
        className="w-60 rounded-xl p-1.5 [&_[data-slot=dropdown-menu-item]]:gap-3 [&_[data-slot=dropdown-menu-item]]:px-3 [&_[data-slot=dropdown-menu-item]]:py-2.5 [&_[data-slot=dropdown-menu-item]]:text-base"
      >
        {/* Who is signed in: the account row this menu replaced said it at
            the foot of the sidebar, and it has to be said somewhere. */}
        <DropdownMenuLabel>
          <p className="truncate font-semibold">{profileDisplayName(profile, email)}</p>
          <p className="text-muted-foreground truncate text-xs font-normal">
            {demo ? "Demo mode, no login" : email}
            {role ? ` · ${role}` : ""}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="group/profile" render={<Link href="/settings/profile" />}>
          <AnimatedIcon icon={Fingerprint} size={18} /> Profile
          {/* It opens elsewhere (the Settings dialog), so it says so on the
              right, and the arrow leans the way it goes while the row is
              hovered. CSS, not an animated glyph: the icon set has no
              diagonal arrow. */}
          <span
            aria-hidden
            className="bg-foreground/[0.08] text-muted-foreground group-hover/profile:text-foreground ml-auto flex size-6 items-center justify-center rounded-md transition-colors"
          >
            <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover/profile:translate-x-0.5 group-hover/profile:-translate-y-0.5 motion-reduce:transition-none" />
          </span>
        </DropdownMenuItem>
        {/* No rule between Profile and the preferences: they are one group,
            the things that are yours. */}
        <ThemeSwitcher />
        <SoundSwitcher />
        {!demo && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOutAction()}>
              <LogOut className="size-[18px]" /> Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The sidebar's room for the Chat surface. Empty on its own: the Teammates
 * layout portals its roster and history into it, because that is where the
 * data and the create dialogs live. Registering on mount, rather than handing
 * a node up, is what lets the peek and the phone drawer take it over while
 * they are open.
 */
export function ChatSidebarSlotHost({ collapsed }: { collapsed: boolean }) {
  const { registerChatSidebarSlot } = useShell();
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return;
    return registerChatSidebarSlot({ element, collapsed });
  }, [element, collapsed, registerChatSidebarSlot]);
  return (
    <div
      ref={setElement}
      aria-label="Chats"
      role="region"
      className={`no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 ${
        collapsed ? "px-2" : "px-3"
      }`}
    />
  );
}
