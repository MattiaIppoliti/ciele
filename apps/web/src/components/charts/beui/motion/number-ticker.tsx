"use client";
// beui.dev number-ticker, trimmed to what Ciele's callers use.

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface NumberTickerProps {
  value: number;
  /** Per-digit roll duration in seconds. */
  duration?: number;
  suffix?: string;
  className?: string;
  /** Formats the rounded value. Client-only. */
  format: (value: number) => string;
}

const DIGIT_HEIGHT_EM = 1.1;
const DIGITS = Array.from({ length: 10 }, (_, n) => n);
/** Seconds between neighbouring digits on the entrance roll. */
const STAGGER = 0.04;

/** Digits hold at 0 until the ticker scrolls into view, then roll in staggered. */
export function NumberTicker({ value, duration = 0.9, suffix, className, format }: NumberTickerProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const armed = useInView(containerRef, { once: true, amount: 0.6 });
  const text = useMemo(() => format(Math.round(value)), [value, format]);
  const glyphs = useMemo(() => {
    const chars = text.split("");
    // Key by place value (position from the right): a changing digit keeps its
    // identity and rolls to the new value instead of remounting and replaying
    // from 0. Growing numbers add glyphs on the left without re-keying the
    // ones, tens, hundreds already on screen.
    return chars.map((char, i) => ({ char, id: `g-${chars.length - 1 - i}` }));
  }, [text]);
  const readableText = `${text}${suffix ?? ""}`;

  // Stagger is an entrance flourish. Once the reveal has played, value
  // changes roll every digit immediately: a per-digit delay on live updates
  // reads as lag.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!armed || entered) return;
    const total = (duration + glyphs.length * STAGGER) * 1000;
    const t = window.setTimeout(() => setEntered(true), total);
    return () => window.clearTimeout(t);
  }, [armed, entered, duration, glyphs.length]);

  return (
    <span ref={containerRef} className={cn("inline-flex items-center tabular-nums", className)}>
      <span className="sr-only">{readableText}</span>
      <span aria-hidden="true" className="inline-flex items-center">
        {glyphs.map(({ char, id }, i) => {
          if (!/\d/.test(char)) {
            return (
              <span key={id} className="inline-block">
                {char}
              </span>
            );
          }
          return (
            <Digit
              key={id}
              digit={armed ? Number(char) : 0}
              delay={entered ? 0 : i * STAGGER}
              duration={duration}
            />
          );
        })}
        {suffix ? <span>{suffix}</span> : null}
      </span>
    </span>
  );
}

function Digit({ digit, delay, duration }: { digit: number; delay: number; duration: number }) {
  const reduce = useReducedMotion();

  return (
    <span
      className="relative inline-block overflow-hidden"
      style={{ height: `${DIGIT_HEIGHT_EM}em`, width: "1ch" }}
    >
      <motion.span
        initial={{ y: 0 }}
        animate={{ y: `-${digit * DIGIT_HEIGHT_EM}em` }}
        transition={reduce ? { duration: 0 } : { duration, delay, ease: EASE_OUT }}
        className="absolute inset-x-0 top-0 flex flex-col items-center will-change-[transform,filter]"
      >
        {DIGITS.map((n) => (
          <span
            key={n}
            className="flex h-[1.1em] items-center justify-center leading-none"
          >
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  );
}
