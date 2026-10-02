"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, X } from "lucide-react";
import styles from "./release-announcement.module.css";

// A new campaign key makes the next release visible even after this one was dismissed.
const STORAGE_KEY = "arc-announcement:ciele-release-2026-09-23";
const CHANGE_EVENT = "ciele-release-announcement-change";
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
function wasDismissed() {
  try { return window.localStorage.getItem(STORAGE_KEY) === "dismissed"; }
  catch { return false; }
}

/** Single-release variant of Arc's announcement bar, with its layout and dismiss motion. */
export function ReleaseAnnouncement({ onHeightChange }: { onHeightChange: (height: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const storedDismissal = useSyncExternalStore(subscribe, wasDismissed, () => false);
  const [closed, setClosed] = useState(false);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => onHeightChange(node.getBoundingClientRect().height));
    observer.observe(node);
    return () => observer.disconnect();
  }, [onHeightChange]);

  return <div ref={ref} className={styles.collapse}>
    <AnimatePresence initial={false}>
      {!closed && !storedDismissal && <motion.section aria-label="New Ciele release" initial={false} animate={{height:"auto",opacity:1}} exit={{height:0,opacity:reducedMotion ? 0 : 1}} transition={reducedMotion ? {duration:0} : {type:"spring",stiffness:280,damping:32}} className={styles.section}>
        <div className={styles.bar}>
          <div aria-hidden="true" />
          <p className={styles.message}>
            <span>Ciele’s latest release is here.</span>
            <Link href="/change-log" className={`${styles.cta} press-text`}>See what’s new <ArrowRight className="size-3.5" aria-hidden="true" /></Link>
          </p>
          <button type="button" aria-label="Dismiss release announcement" className={`${styles.icon} press-control`} onClick={() => {
            setClosed(true);
            try { window.localStorage.setItem(STORAGE_KEY,"dismissed"); } catch { /* Dismiss still works when storage is blocked. */ }
            window.dispatchEvent(new Event(CHANGE_EVENT));
          }}><X className="size-4" aria-hidden="true" /></button>
        </div>
      </motion.section>}
    </AnimatePresence>
  </div>;
}
