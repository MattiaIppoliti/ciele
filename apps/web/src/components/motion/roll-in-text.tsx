"use client";

import type { Scritto } from "@scritto/core";
import { useReducedMotion } from "motion/react";
import { createContext, createElement, useContext, useLayoutEffect, useRef } from "react";
import { isInitialCommit } from "./page-reveal";

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

export const TableText = createContext(false);

export function RollInText(props: { text: string; className?: string; duration?: number; entrance?: boolean }) {
  const table = useContext(TableText);
  return table ? <span className={props.className}>{props.text}</span> : <AnimatedRollInText {...props} />;
}

function AnimatedRollInText({
  text,
  className,
  duration = TITLE_ROLL_MS,
  entrance: entranceProp,
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
}) {
  const host = useRef<HTMLSpanElement>(null);
  const latest = useRef(text);
  const reduce = useReducedMotion() ?? false;
  const inherited = useContext(RollEntrance);
  const mayEnter = entranceProp ?? inherited;
  /** Whether the element has taken over drawing the text. */
  const live = useRef(false);

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
      !reduce &&
      !(isInitialCommit() && !span.closest('[data-page-reveal="pending"]'));
    // An entrance starts from nothing, so the title waits unseen for the
    // element instead of showing and then vanishing when it takes over.
    if (entrance) span.style.opacity = "0";
    let cancelled = false;
    let frame = 0;
    loadScritto().then(
      () => {
        if (cancelled) return;
        const el = span.querySelector<Scritto>("scritto-text");
        span.style.opacity = "";
        if (!el) return;
        el.setOptions({ transition: { duration } });
        live.current = true;
        if (!entrance) {
          el.update(latest.current, false);
          return;
        }
        el.update("", false);
        frame = requestAnimationFrame(() => el.update(latest.current, true));
      },
      // Offline or blocked: the plain text child is still there to read.
      () => {
        span.style.opacity = "";
      },
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      span.style.opacity = "";
    };
    // Mount only: later changes of `text` roll through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!live.current) return;
    host.current?.querySelector<Scritto>("scritto-text")?.update(text, !reduce);
  }, [text, reduce]);

  return (
    <span ref={host} className={className}>
      {createElement("scritto-text", { role: "img", "aria-label": text }, text)}
    </span>
  );
}
