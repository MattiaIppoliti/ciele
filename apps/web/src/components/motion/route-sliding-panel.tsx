"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { SlidingPanelDirection } from "./sliding-panel";

let finishNavigation: (() => void) | undefined;
let running: ViewTransition | undefined;
let navigationGeneration = 0;
/** Browser snapshots keep outgoing routes inert without mounting a stale LayoutRouter. */
export function startRouteSlide(
  navigate: () => void,
  direction: SlidingPanelDirection,
) {
  const generation = ++navigationGeneration;
  document.documentElement.style.setProperty(
    "--tab-enter-x",
    `${direction * 100}%`,
  );
  document.documentElement.style.setProperty(
    "--tab-exit-x",
    `${-direction * 100}%`,
  );
  if (
    !document.startViewTransition ||
    !document.querySelector("[data-route-sliding-panel]")
  ) {
    navigate();
    return;
  }
  running?.skipTransition();
  finishNavigation?.();
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        if (generation !== navigationGeneration) {
          resolve();
          return;
        }
        const finish = () => {
          clearTimeout(timeout);
          if (finishNavigation === finish) finishNavigation = undefined;
          resolve();
        };
        const timeout = window.setTimeout(finish, 1800);
        finishNavigation = finish;
        navigate();
      }),
  );
  running = transition;
  void transition.finished
    .catch(() => {})
    .finally(() => {
      if (running === transition) running = undefined;
    });
}
export function RouteSlidingPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const previousPath = useRef(pathname);
  useLayoutEffect(() => {
    const changed = previousPath.current !== pathname;
    previousPath.current = pathname;
    if (!finishNavigation) {
      if (!changed) return;
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const animation = panel.current?.animate(
        [
          {
            opacity: 0,
            transform: reduce
              ? "translateX(0)"
              : `translateX(${document.documentElement.style.getPropertyValue("--tab-enter-x") || "100%"})`,
          },
          { opacity: 1, transform: "translateX(0)" },
        ],
        { duration: reduce ? 150 : 220, easing: "cubic-bezier(.23,1,.32,1)" },
      );
      return () => animation?.cancel();
    }
    const root = document.querySelector("[data-route-sliding-panel]");
    const ready = () => {
      if (!root?.querySelector('[data-slot="skeleton"]')) {
        observer.disconnect();
        finishNavigation?.();
      }
    };
    const observer = new MutationObserver(ready);
    if (root) observer.observe(root, { subtree: true, childList: true });
    ready();
    return () => observer.disconnect();
  }, [pathname]);
  return (
    <div
      ref={panel}
      className={className}
      data-route-sliding-panel
      style={{ viewTransitionName: "tab-page" }}
    >
      {children}
    </div>
  );
}
