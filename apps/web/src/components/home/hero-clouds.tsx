"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";

/* Painterly hero clouds. On load they slide in from the side edges to
   their resting spot; from there scroll drives them back out toward the
   top corners (and in again on scroll up). The wrappers own entrance +
   scroll transforms while the inner images keep the idle drift animation,
   so the three motions compose instead of fighting over `transform`.

   On top of that the wrappers parallax toward the cursor: a pointer offset
   is eased into --cloud-px / --cloud-py and composed as a second translate
   in CSS, mirrored left/right so the two clouds lean in opposite ways. */

/* Scroll distance (px) over which the clouds fully reach the corners. */
const SCROLL_RANGE = 480;

/* Cursor parallax: max wrapper shift (px) and how fast it eases to target. */
const PARALLAX_STRENGTH = 20;
const PARALLAX_EASE = 0.05;

export function HeroClouds() {
  const ref = useRef<HTMLDivElement>(null);
  const leftWrapRef = useRef<HTMLDivElement>(null);
  const rightWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // The app shell pins <body>, so /home scrolls inside .home-scene —
    // listen there (fall back to the window just in case).
    const scroller = el.closest(".home-scene");
    const scrollTop = () =>
      scroller ? scroller.scrollTop : window.scrollY;

    // Refresh mid-page: skip the entrance so clouds don't fly in and snap.
    if (scrollTop() > 24) el.dataset.noEnter = "";

    let raf = 0;
    const update = () => {
      raf = 0;
      const progress = Math.min(scrollTop() / SCROLL_RANGE, 1);
      el.style.setProperty("--cloud-out", progress.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    const target = scroller ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });

    // ── Cursor parallax ──────────────────────────────────────────────
    // Only a real fine pointer; honour reduced-motion.
    const canParallax =
      window.matchMedia("(pointer: fine)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let parallaxRaf = 0;
    let onMouseMove: ((e: MouseEvent) => void) | null = null;

    if (canParallax) {
      const leftWrap = leftWrapRef.current;
      const rightWrap = rightWrapRef.current;
      // Target offset from cursor (px), eased into the live drift each frame.
      const pointer = { x: 0, y: 0 };
      const drift = { x: 0, y: 0 };

      onMouseMove = (event: MouseEvent) => {
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        pointer.x = (event.clientX / w - 0.5) * PARALLAX_STRENGTH * 2;
        pointer.y = (event.clientY / h - 0.5) * PARALLAX_STRENGTH * 2;
      };
      window.addEventListener("mousemove", onMouseMove, { passive: true });

      const frame = () => {
        drift.x += (pointer.x - drift.x) * PARALLAX_EASE;
        drift.y += (pointer.y - drift.y) * PARALLAX_EASE;
        // Left leans one way, right the opposite — like the ASCII hands.
        if (leftWrap) {
          leftWrap.style.setProperty("--cloud-px", `${drift.x}px`);
          leftWrap.style.setProperty("--cloud-py", `${-drift.y}px`);
        }
        if (rightWrap) {
          rightWrap.style.setProperty("--cloud-px", `${-drift.x}px`);
          rightWrap.style.setProperty("--cloud-py", `${-drift.y}px`);
        }
        parallaxRaf = requestAnimationFrame(frame);
      };
      parallaxRaf = requestAnimationFrame(frame);
    }

    return () => {
      target.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      if (onMouseMove) window.removeEventListener("mousemove", onMouseMove);
      if (parallaxRaf) cancelAnimationFrame(parallaxRaf);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 dark:brightness-[.65] dark:saturate-[.85]"
    >
      <div
        ref={leftWrapRef}
        className="home-cloud-wrap-left absolute -left-24 top-4 w-[24rem] md:w-[34rem]"
      >
        {/* `sizes` must track the wrapper's width above. Without it the
            browser assumes the image fills the viewport and preloads a
            1920-wide render of something drawn 544px across — and `priority`
            means that download competes with the hero's own first paint. */}
        <Image
          src="/images/home/cloud-left.png"
          alt=""
          width={1212}
          height={641}
          priority
          sizes="(min-width: 768px) 34rem, 24rem"
          className="home-cloud w-full"
        />
      </div>
      <div
        ref={rightWrapRef}
        className="home-cloud-wrap-right absolute -right-28 top-0 w-[26rem] md:w-[36rem]"
      >
        <Image
          src="/images/home/cloud-right.png"
          alt=""
          width={1180}
          height={620}
          priority
          sizes="(min-width: 768px) 36rem, 26rem"
          className="home-cloud home-cloud-slow w-full"
        />
      </div>
    </div>
  );
}
