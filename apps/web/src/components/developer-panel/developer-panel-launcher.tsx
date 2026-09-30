"use client";

import { createElement, useEffect, useReducer } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { panelDomainsForPath } from "@/components/shell/nav";
import { useShell } from "@/components/shell/shell-provider";
import { useIdle } from "@/lib/hooks/use-idle";
import { createPreloader } from "@/lib/preloader";

/**
 * The panel's code, fetched when the browser is idle and rendered directly
 * once it lands, so the first open is immediate, the same fix as the live
 * Preview's (see `createPreloader`).
 */
const developerPanelCode = createPreloader(() => import("./developer-panel"));

/**
 * Mounts the Developer Panel when it holds the right rail (#754).
 *
 * It is the left sidebar mirrored: it sits on the shell's frame to the right of
 * the workspace panel, not inside it, and grows and folds on the sidebar's
 * springs. `AnimatePresence` keeps it on screen while it folds, then unmounts
 * it: nothing in it is worth keeping across a close. There is no collapsed
 * rail: the way back in is the top-bar button and `D`.
 */
export function DeveloperPanelLauncher() {
  const pathname = usePathname();
  const { rightRail } = useShell();
  const domains = panelDomainsForPath(pathname);
  const open = rightRail === "developer" && domains.length > 0;
  const [, codeLanded] = useReducer((n: number) => n + 1, 0);

  // Warm the code once the page has settled, so the first open has it.
  useIdle(developerPanelCode.prefetch, 2000);

  // An open before the code is here (faster than the warm-up, or during it):
  // fetch now, sharing the warm-up's request, and render when it lands.
  useEffect(() => {
    if (open && !developerPanelCode.loaded()) {
      developerPanelCode.load().then(codeLanded, () => {});
    }
  }, [open]);

  const developerPanel = developerPanelCode.loaded()?.DeveloperPanel ?? null;
  return (
    <AnimatePresence initial={false}>
      {open && developerPanel
        ? createElement(developerPanel, { key: "developer", domains })
        : null}
    </AnimatePresence>
  );
}
