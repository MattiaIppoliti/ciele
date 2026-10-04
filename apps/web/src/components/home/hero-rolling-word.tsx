"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion, type UseInViewOptions } from "motion/react";
import { RollInText } from "@/components/motion/roll-in-text";

export interface HeroRollingWordProps {
  prefix?: string;
  words: string[];
  suffix?: string;
  foregroundColor?: string;
  duration?: number;
  delay?: number;
  pauseDuration?: number;
  loop?: boolean;
  startOnView?: boolean;
  once?: boolean;
  inViewMargin?: UseInViewOptions["margin"];
  className?: string;
}

/** Reserve the longest word's width while Scritto rolls only the changing noun. */
export function HeroRollingWord({
  prefix = "",
  words,
  suffix = "",
  foregroundColor,
  duration = 1.2,
  delay = 0,
  pauseDuration = 0.8,
  loop = true,
  startOnView = true,
  once = true,
  inViewMargin,
  className,
}: HeroRollingWordProps) {
  const host = useRef<HTMLSpanElement>(null);
  const [index, setIndex] = useState(0);
  const reduced = useReducedMotion();
  const visible = useInView(host, { once, margin: inViewMargin });
  const active = !startOnView || visible;
  const last = index >= words.length - 1;

  useEffect(() => {
    if (!active || reduced || words.length < 2 || (!loop && last)) return;
    const timer = window.setTimeout(
      () => setIndex((current) => (current + 1) % words.length),
      (duration + pauseDuration + (index === 0 ? delay : 0)) * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [active, reduced, words.length, loop, last, duration, pauseDuration, delay, index]);

  return (
    <span ref={host} className={`inline-flex items-baseline ${className ?? ""}`}>
      {prefix && <span>{prefix}{words.length > 0 ? " " : ""}</span>}
      {words.length > 0 && (
        <span className="relative inline-grid" style={{ color: foregroundColor }}>
          {Array.from(new Set(words)).map((word) => (
            <span key={word} aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
              {word}{suffix}
            </span>
          ))}
          <RollInText
            text={`${words[index % words.length]}${suffix}`}
            entrance={false}
            duration={duration * 1000}
            className="col-start-1 row-start-1 whitespace-nowrap"
          />
        </span>
      )}
    </span>
  );
}
