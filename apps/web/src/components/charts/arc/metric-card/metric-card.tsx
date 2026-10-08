"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, type Variants } from "motion/react";
import { TRANSITION_RESIZE, TRANSITION_TEXT_SWAP } from "@/lib/ease";
import { motionTokens } from "../motion-tokens";
import { AnimatedCounter } from "../animated-counter/animated-counter";
import { AnalyticsCard } from "@/components/insights/analytics-card";
import styles from "./metric-card.module.css";
export interface MetricCardProps { label: string; value: number; prefix?: string; suffix?: string; decimals?: number; context?: string; change?: string; children?: ReactNode; action?: ReactNode; bare?: boolean }

/** Copy that holds a number enters from the side it moved toward: a larger value rises from below, a smaller one drops from above. */
const rise: Variants = { hidden: (direction: number) => ({ opacity: 0, y: 4 * direction, filter: "blur(2px)" }), shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: TRANSITION_TEXT_SWAP }, gone: (direction: number) => ({ opacity: 0, y: -4 * direction, filter: "blur(2px)", transition: TRANSITION_TEXT_SWAP }) };
const fade: Variants = { hidden: { opacity: 0, y: 0, filter: "blur(0px)" }, shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.instant } }, gone: { opacity: 0, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.instant } } };
const amountIn = (text: string) => Number(text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN);

/** New copy rises in while the old copy leaves; `morph` resizes the wrapper to the new text's width instead of letting it snap. */
function Swap({ text, morph = false, block = false }: { text: string; morph?: boolean; block?: boolean }) {
  const reduceMotion = !!useReducedMotion();
  const sizer = useRef<HTMLSpanElement>(null);
  const width = useMotionValue<number | "auto">("auto");
  const [shown, setShown] = useState({ text, direction: 1 });
  if (shown.text !== text) setShown({ text, direction: amountIn(text) < amountIn(shown.text) ? -1 : 1 });
  useEffect(() => {
    const node = sizer.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let measured: string | null = null;
    // Layout size, not the transformed rect, so a scaling parent never leaves the text clipped. Only new text animates; font loads jump.
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.borderBoxSize?.[0]?.inlineSize ?? node.offsetWidth;
      if (next && measured !== null && measured !== node.textContent && !reduceMotion) animate(width, next, TRANSITION_RESIZE);
      else width.jump(next || "auto");
      measured = next ? node.textContent : null;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [morph, reduceMotion, width]);
  return <motion.span className={block ? styles.swapBlock : styles.swap} style={morph ? { width } : undefined}>
    {morph && <span ref={sizer} className={styles.sizer} aria-hidden="true">{text}</span>}
    <AnimatePresence mode="popLayout" initial={false} custom={shown.direction}><motion.span key={text} className={styles.text} custom={shown.direction} variants={reduceMotion ? fade : rise} initial="hidden" animate="shown" exit="gone">{text}</motion.span></AnimatePresence>
  </motion.span>;
}

export function MetricCard({ label, value, prefix, suffix, decimals, context, change, children, action, bare }: MetricCardProps) {
  const reduceMotion = !!useReducedMotion();
  const changeBadge = <AnimatePresence initial={false}>{change && <motion.small className={styles.change} key="change" data-trend={/^[+]/.test(change) ? "up" : /^[-−]/.test(change) ? "down" : undefined} initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .96, transition: { duration: motionTokens.duration.fast } }} transition={reduceMotion ? { duration: 0 } : motionTokens.spring.snappy}><Swap text={change} morph /></motion.small>}</AnimatePresence>;
  return <AnalyticsCard title={<Swap text={label} block />} description={context ? <Swap text={context} block /> : undefined} bare={bare}
    action={change || action ? <>{changeBadge}{action}</> : undefined}>
    <AnimatedCounter value={value} prefix={prefix} suffix={suffix} decimals={decimals} animateOnView />
    {children}
  </AnalyticsCard>;
}
