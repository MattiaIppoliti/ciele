import type { Ref } from "react";

export function GhostMark({
  className,
  eyesClassName,
  svgRef,
  eyesRef,
}: {
  className?: string;
  /** Optional class applied to the <g> wrapping the two eyes, lets callers
   *  animate the gaze (e.g. the footer's left/right glance). */
  eyesClassName?: string;
  /** Refs to the root <svg> and the eyes <g>, lets a client caller drive the
   *  gaze imperatively (e.g. follow the cursor on the home hero). */
  svgRef?: Ref<SVGSVGElement>;
  eyesRef?: Ref<SVGGElement>;
}) {
  return (
    <svg
      ref={svgRef}
      className={className}
      viewBox="0 0 212 186"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M38 156H181V127C181 76 148 27 104 27C73 27 53 48 53 80C39 86 31 101 31 123C31 135 34 146 38 156Z"
        fill="white"
        stroke="#7F7F7F"
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g ref={eyesRef} className={eyesClassName}>
        <path
          d="M101 72H99C94.5817 72 91 75.5817 91 80V104C91 108.418 94.5817 112 99 112H101C105.418 112 109 108.418 109 104V80C109 75.5817 105.418 72 101 72Z"
          fill="#7F7F7F"
        />
        <path
          d="M136 72H134C129.582 72 126 75.5817 126 80V104C126 108.418 129.582 112 134 112H136C140.418 112 144 108.418 144 104V80C144 75.5817 140.418 72 136 72Z"
          fill="#7F7F7F"
        />
      </g>
    </svg>
  );
}
