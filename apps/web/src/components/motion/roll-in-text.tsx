"use client";

import type { Scritto } from "@scritto/core";
import { useReducedMotion } from "motion/react";
import { createElement, useLayoutEffect, useRef } from "react";
import { isInitialCommit } from "./page-reveal";

/**
 * Slower than Scritto's 550ms default, so a title visibly builds letter by
 * letter instead of landing almost in one piece. Module scope: a fresh object
 * per render would re-run Scritto's option effect every time.
 */
const ROLL = { duration: 900 };

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
export function RollInText({ text, className }: { text: string; className?: string }) {
  const host = useRef<HTMLSpanElement>(null);
  const latest = useRef(text);
  const reduce = useReducedMotion() ?? false;
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
      !reduce && !(isInitialCommit() && !span.closest('[data-page-reveal="pending"]'));
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
        el.setOptions({ transition: ROLL });
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
