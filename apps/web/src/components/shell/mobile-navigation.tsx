"use client";

import { lazy, Suspense, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Dialog as BaseDialog } from "@base-ui/react/dialog";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { House, MessageCircle, Settings } from "lucide-react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import type { Role } from "@agent-hub/core";
import { Dialog, DialogContent, DialogTitle } from "@agent-hub/ui";
import { useShell } from "@/components/shell/shell-provider";
import { SETTINGS_HOME, PERSONAL_SETTINGS_HOME } from "@/components/settings/settings-nav";
import { canManageMembers } from "@/lib/rbac";
import { SPRING_LAYOUT } from "@/lib/ease";
import { isPlainClick } from "@/lib/plain-click";

const TOUCH_QUERY = "(max-width: 1023px), (hover: none) and (pointer: coarse)";
const subscribeTouch = (notify: () => void) => {
  const query = window.matchMedia(TOUCH_QUERY);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const readTouch = () => window.matchMedia(TOUCH_QUERY).matches;
const serverTouch = () => false;
export const useTouchNavigation = () => useSyncExternalStore(subscribeTouch, readTouch, serverTouch);
const HomePicker = lazy(() => import("./mobile-home-picker"));

/** Icon-only navigation also lives inside Settings' modal focus boundary. */
export function MobileDock({ settingsHref, onHome, onNavigate }: {
  settingsHref: string;
  onHome?: () => void;
  onNavigate?: (event: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
}) {
  const pathname = usePathname();
  const { navDrawerOpen } = useShell();
  const reduce = useReducedMotion();
  const home = navDrawerOpen || (!pathname.startsWith("/teammates") && !pathname.startsWith("/settings"));
  const chat = !home && pathname.startsWith("/teammates");
  const settings = !home && pathname.startsWith("/settings");
  const cls = (active: boolean) => `press-control relative flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 ${active ? "text-white" : "text-white/75 hover:bg-white/10 hover:text-white"}`;
  // One dock is visible at a time. Keep its pill identity across the Home and
  // Settings focus boundaries so their replacement docks continue the glide.
  const indicator = (active: boolean) => active && <motion.span aria-hidden initial={false} layoutId="mobile-navigation-pill" style={{ borderRadius: 9999 }} className="absolute inset-0 bg-white/12" />;
  return <MotionConfig transition={reduce ? { duration: 0 } : SPRING_LAYOUT}>
    <nav aria-label="Primary navigation" className="mobile-dock touch-navigation fixed z-[70] flex gap-1 rounded-full p-1">
      {onHome ? <button type="button" aria-label="Home" aria-current={home ? "page" : undefined} onClick={onHome} className={cls(home)}>{indicator(home)}<House size={22} className="relative" /></button> : <Link href="/?navigation=home" aria-label="Home" aria-current={home ? "page" : undefined} className={cls(home)} onClick={e => onNavigate?.(e, "/?navigation=home")}>{indicator(home)}<House size={22} className="relative" /></Link>}
      <Link href="/teammates" aria-label="Chat" aria-current={chat ? "page" : undefined} className={cls(chat)} onClick={e => onNavigate?.(e, "/teammates")}>{indicator(chat)}<MessageCircle size={22} className="relative" /></Link>
      <Link href={settingsHref} aria-label="Settings" aria-current={settings ? "page" : undefined} className={cls(settings)} onClick={e => onNavigate?.(e, settingsHref)}>{indicator(settings)}<Settings size={22} className="relative" /></Link>
    </nav>
  </MotionConfig>;
}

export function MobileNavigation({ role }: { role: Role | null }) {
  const { navDrawerOpen, setNavDrawerOpen } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const requested = pathname === "/" && query.get("navigation") === "home";
  const touch = useTouchNavigation();
  const open = touch && (navDrawerOpen || requested);
  const actions = useRef<BaseDialog.Root.Actions>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<{ top: number; left: number; width: number; height: number }>();
  useLayoutEffect(() => {
    if (!open) return;
    const content = document.getElementById("main-content");
    if (!content) return;
    // The menu shares the page frame, including its real header height and
    // inset. ResizeObserver also follows text zoom and header action changes.
    const measure = () => {
      const { top, left, width, height } = content.getBoundingClientRect();
      setBounds(previous => previous?.top === top && previous.left === left &&
        previous.width === width && previous.height === height
        ? previous : { top, left, width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    window.addEventListener("resize", measure);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
    };
  }, [open]);
  const settingsHref = canManageMembers(role) ? SETTINGS_HOME : PERSONAL_SETTINGS_HOME;
  const close = () => { setNavDrawerOpen(false); if (requested) router.replace("/"); };
  const requestClose = () => actions.current?.close();
  return <>
    {!open && !pathname.startsWith("/settings") && <MobileDock settingsHref={settingsHref} onHome={() => setNavDrawerOpen(true)} />}
    {/* Keep the normal page header and the content beside the rail available. */}
    <Dialog modal={false} open={open} actionsRef={actions} onOpenChange={(next, details) => {
      if (next) return;
      // Hold the popup for the spring's actual completion, not a fixed timer.
      // A close during the lazy loading placeholder can unmount immediately.
      if (popup.current?.querySelector("[data-home-wheel]")) details.preventUnmountOnClose();
      close();
    }}>
      <DialogContent ref={popup} showCloseButton={false} overlayClassName="hidden" style={bounds} className="touch-navigation mobile-home top-0 left-0 flex h-dvh max-h-none max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none ring-0 outline-none sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100">
        <motion.button type="button" tabIndex={-1} aria-label="Close navigation" disabled={!open} initial={{ opacity: 0 }} animate={{ opacity: open ? 1 : 0 }} transition={{ duration: 0.18 }} onClick={requestClose} className="mobile-home-backdrop" />
        <DialogTitle className="sr-only">Home navigation</DialogTitle>
        <Suspense fallback={<p className="p-6">Loading navigation…</p>}><HomePicker role={role} open={open} onExitComplete={() => { if (!open) actions.current?.unmount(); }} onNavigate={href => { requestClose(); router.push(href); }} /></Suspense>
        {open && <MobileDock settingsHref={settingsHref} onHome={requestClose} onNavigate={event => { if (isPlainClick(event)) requestClose(); }} />}
      </DialogContent>
    </Dialog>
  </>;
}
