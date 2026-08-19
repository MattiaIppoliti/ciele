/**
 * Ciele ghost brand mark. Copied from the platform app
 * (apps/web/src/components/auth/ghost-mark.tsx) so the docs app stays
 * self-contained, the two apps do not share a component package.
 */
export function GhostMark({
  className,
  eyesClassName,
}: {
  className?: string;
  eyesClassName?: string;
}) {
  return (
    <svg
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
      <g className={eyesClassName}>
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
