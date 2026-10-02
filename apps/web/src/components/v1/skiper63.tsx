"use client";

// Adapted from Skiper UI, Apple squicircle effect, by gxuri.
// https://skiper-ui.com/v1/skiper63 — attribution and terms in skiper63.NOTICE.md.
import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

type FilterProps = {
  blurValue?: number;
  colorMatrixValue?: number;
  alphaValue?: number;
  id?: string;
};

export function SquiCircleFilter({
  blurValue = 10,
  colorMatrixValue = 20,
  alphaValue = -7,
  id = "SquiCircleFilter",
}: FilterProps) {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="pointer-events-none absolute" data-slot="squircle-filters">
      <defs>
        <filter id={id} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={blurValue} result="blur" />
          <feColorMatrix in="blur" type="matrix" values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${colorMatrixValue} ${alphaValue}`} result="goo" />
          <feBlend in="SourceGraphic" in2="goo" />
        </filter>
      </defs>
    </svg>
  );
}

export function SquiCircleFilterStatic() {
  return <SquiCircleFilter id="SkiperSquiCircleFilterLayout" />;
}

const subscribe = () => () => {};
const clientBody = () => document.body;
const serverBody = () => null;

/** One definition per document, outside filtered surfaces and their portals.
 * Keep it client-only so every server document does not serialize the same SVG. */
export function AppSquircleFilter() {
  const body = useSyncExternalStore(subscribe, clientBody, serverBody);
  useEffect(() => {
    if (!body) return;
    document.documentElement.setAttribute("data-squircle-ready", "");
    return () => document.documentElement.removeAttribute("data-squircle-ready");
  }, [body]);
  return body ? createPortal(<SquiCircleFilter blurValue={10} colorMatrixValue={20} alphaValue={-7} />, body) : null;
}
