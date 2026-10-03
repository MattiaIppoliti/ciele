"use client";

import type { Scritto } from "@scritto/core";
import { useReducedMotion } from "motion/react";
import { createContext, createElement, useContext, useLayoutEffect, useRef } from "react";
import { isInitialCommit } from "./page-reveal";
import { fitRollingText } from "./fit-rolling-text";

/**
 * Slower than Scritto's 550ms default, so a title visibly builds letter by
 * letter instead of landing almost in one piece. A caller whose value changes
 * often (a count that follows typing) passes a shorter one.
 */
const TITLE_ROLL_MS = 900;

/**
 * Scritto is loaded on demand, never imported statically. A static import put
 * its chunk in the chunk list of every client reference row of every document,
 * and across the prerendered pages that alone pushed the RSC payload over the
 * `measure-document` budget. One import per visit, shared by every title.
 */
let loading: Promise<unknown> | null = null;
function loadScritto(): Promise<unknown> {
  return (loading ??= import("@scritto/core"));
}

/**
 * A short line of text (a page title, a label) that rolls in glyph by glyph
 * when it mounts, and rolls between values when it changes: renaming an
 * Assistant rolls its title instead of swapping it.
 *
 * The server renders the text inside `<scritto-text>` as a plain child, which
 * is what crawlers and the first paint get. Once Scritto defines the element,
 * it draws the value in its shadow root and that child stops showing. Keep it
 * to a line: every glyph becomes its own span, so kerning and ligatures are
 * off inside it and it only wraps between words.
 */
/**
 * How many rows of a table, list or card grid roll their text in when it
 * appears. Past this the rows are below the fold or late enough in the cascade
 * that nobody watches them build, and a few hundred cells each rolling from
 * blank is work for no one; they still roll whenever a value changes.
 */
export const ROLL_ENTRANCE_ROWS = 10;

/** Whether the row at `index` rolls its text in when the list appears. */
export function rollsInAt(index: number): boolean {
  return index < ROLL_ENTRANCE_ROWS;
}

const RollEntrance = createContext(true);

/**
 * Wrap each row of a list so every `RollInText` inside it knows whether it may
 * roll in: the first `ROLL_ENTRANCE_ROWS` do, later ones appear as plain text
 * and roll only on change. Cells then need no index of their own.
 */
export function RollRow({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <RollEntrance.Provider value={rollsInAt(index)}>{children}</RollEntrance.Provider>
  );
}

export function RollInText({
  text,
  className,
  duration = TITLE_ROLL_MS,
  entrance: entranceProp,
  truncate,
}: {
  text: string;
  className?: string;
  /** Roll length in ms; read once, when the element takes over. */
  duration?: number;
  /**
   * Whether it rolls in from blank on mount. Defaults to the enclosing
   * `RollRow`'s answer, or yes outside one. A change of `text` rolls either way.
   */
  entrance?: boolean;
  /** Pass the current mode when a responsive label switches truncation on/off. */
  truncate?: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const latest = useRef(text);
  const reduce = useReducedMotion() ?? false;
  const inherited = useContext(RollEntrance);
  const mayEnter = entranceProp ?? inherited;
  /** Whether the element has taken over drawing the text. */
  const live = useRef(false);
  const initialized = useRef(false);
  const displayText = useRef((value: string) => value);

  // Declared first so it runs first: the load below reads the newest text.
  useLayoutEffect(() => {
    latest.current = text;
  });

  useLayoutEffect(() => {
    const span = host.current;
    if (!span) return;
    // On the first page of a visit the server already painted this text, and
    // rolling it in would flash. The exception is a page still hidden by a
    // pending PageReveal: nobody has seen the title yet.
    const entrance =
      mayEnter &&
      !initialized.current &&
      !reduce &&
      !(isInitialCommit() && !span.closest('[data-page-reveal="pending"]'));
    // An entrance starts from nothing, so the title waits unseen for the
    // element instead of showing and then vanishing when it takes over.
    if (entrance) span.style.opacity = "0";
    let cancelled = false;
    let frame = 0;
    let observer: ResizeObserver | undefined;
    loadScritto().then(
      () => {
        if (cancelled) return;
        const el = span.querySelector<Scritto>("scritto-text");
        span.style.opacity = "";
        if (!el) return;
        el.setOptions({ transition: { duration } });
        // A custom element is an atomic inline box, so its shadow-root glyphs
        // cannot receive the parent's native text-overflow ellipsis. Fit the
        // displayed value to a truncating container; aria-label keeps the full
        // value. Observe only constrained labels, never every table cell.
        const container = truncate === false ? null : span.closest<HTMLElement>(".truncate");
        if (container) {
          const context = document.createElement("canvas").getContext("2d");
          if (context) {
            const parent = container.parentElement;
            const style = getComputedStyle(container);
            // A tag or an inline label owns its intrinsic width. Use the
            // enclosing slot's room so a longer value can grow before fitting.
            const intrinsic = parent && (style.display === "inline" ||
              style.display === "inline-block" ||
              (getComputedStyle(parent).display.includes("flex") && style.flexGrow === "0"));
            const slot = intrinsic ? parent : container;
            displayText.current = (value) => {
              if (!container.matches(".truncate")) return value;
              const style = getComputedStyle(span);
              context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
              context.fontKerning = "none";
              const spacing = parseFloat(style.letterSpacing) || 0;
              const containerStyle = getComputedStyle(slot);
              const labelStyle = getComputedStyle(container);
              const siblings = intrinsic ? Array.from(slot.children).filter((child) => child !== container) : [];
              const width = slot.clientWidth -
                (parseFloat(containerStyle.paddingLeft) || 0) -
                (parseFloat(containerStyle.paddingRight) || 0) -
                siblings.reduce((total, child) => total + child.getBoundingClientRect().width, 0) -
                siblings.length * (parseFloat(containerStyle.columnGap) || 0) -
                (intrinsic ? (parseFloat(labelStyle.paddingLeft) || 0) + (parseFloat(labelStyle.paddingRight) || 0) +
                  (parseFloat(labelStyle.borderLeftWidth) || 0) + (parseFloat(labelStyle.borderRightWidth) || 0) : 0);
              return fitRollingText(value, width, (glyph) => context.measureText(glyph).width + spacing);
            };
            let width = slot.clientWidth;
            observer = new ResizeObserver(() => {
              if (width === slot.clientWidth) return;
              width = slot.clientWidth;
              el.update(displayText.current(latest.current), false);
            });
            observer.observe(slot);
            if (document.fonts.status === "loading") void document.fonts.ready.then(() => {
              if (!cancelled) el.update(displayText.current(latest.current), false);
            });
          }
        }
        live.current = true;
        initialized.current = true;
        if (!entrance) {
          el.update(displayText.current(latest.current), false);
          return;
        }
        el.update("", false);
        frame = requestAnimationFrame(() => el.update(displayText.current(latest.current), true));
      },
      // Offline or blocked: the plain text child is still there to read.
      () => {
        span.style.opacity = "";
      },
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      live.current = false;
      displayText.current = (value) => value;
      span.style.opacity = "";
    };
    // Rebind only when a responsive caller switches truncation modes.
    // Later changes of `text` roll through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truncate]);

  useLayoutEffect(() => {
    if (!live.current) return;
    host.current?.querySelector<Scritto>("scritto-text")?.update(displayText.current(text), !reduce);
  }, [text, reduce]);

  return (
    <span ref={host} className={className}>
      {createElement("scritto-text", { role: "img", "aria-label": text }, text)}
    </span>
  );
}
