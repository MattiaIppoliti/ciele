"use client";

import { useRef, useState } from "react";
import { useInView } from "motion/react";
import styles from "./animated-counter.module.css";

export interface AnimatedCounterProps {
  value: number; label?: string; prefix?: string; suffix?: string; decimals?: number;
  /** Reveal the digits when the counter first scrolls into view. */
  animateOnView?: boolean;
  /** Fixed by default so server and client format the same number. */
  locale?: string;
}

/** Transitions.dev number pop-in. A new keyed group replays on a value change. */
export function AnimatedCounter({ value, label, prefix = "", suffix = "", decimals = 0, animateOnView = false, locale = "en-US" }: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: .6 });
  const [previous, setPrevious] = useState({ value, direction: 1 });
  if (previous.value !== value) setPrevious({ value, direction: value < previous.value ? -1 : 1 });
  const number = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, numberingSystem: "latn" }).format(value);
  const text = `${prefix}${number}${suffix}`;
  const characters = [...number];
  const animate = !animateOnView || inView;
  return <span ref={ref} className={styles.counter}>
    {label && <span className={styles.label}>{label}</span>}
    <span className={styles.srOnly}>{text}</span>
    <span key={text} className={`${styles.value} t-digit-group ${animate ? "is-animating" : ""}`} aria-hidden="true" data-direction={previous.direction < 0 ? "down" : "up"}>
      {prefix && <span>{prefix}</span>}
      {characters.map((char, index) => <span key={index} className="t-digit" data-stagger={index === characters.length - 2 ? "1" : index === characters.length - 1 ? "2" : undefined}>{char}</span>)}
      {suffix && <span>{suffix}</span>}
    </span>
  </span>;
}

export default AnimatedCounter;
