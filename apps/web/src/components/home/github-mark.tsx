/**
 * The GitHub mark, inline.
 *
 * lucide dropped its brand icons in v1, and the repo link is the only brand
 * glyph the marketing header needs, so it is one path here rather than a new
 * icon dependency. `currentColor` so it inherits the button's text color in
 * both themes.
 */
export function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d="M12 .5C5.73.5.99 5.24.99 11.5c0 4.86 3.15 8.98 7.52 10.44.55.1.75-.24.75-.53v-1.87c-3.06.66-3.71-1.48-3.71-1.48-.5-1.28-1.22-1.62-1.22-1.62-1-.68.08-.67.08-.67 1.11.08 1.69 1.14 1.69 1.14.98 1.69 2.58 1.2 3.21.92.1-.72.39-1.21.7-1.49-2.44-.28-5.01-1.22-5.01-5.45 0-1.2.43-2.19 1.13-2.96-.11-.28-.49-1.4.11-2.92 0 0 .93-.3 3.05 1.13a10.5 10.5 0 0 1 5.56 0c2.12-1.43 3.04-1.13 3.04-1.13.61 1.52.23 2.64.12 2.92.71.77 1.13 1.76 1.13 2.96 0 4.24-2.58 5.17-5.03 5.44.4.34.75 1.02.75 2.06v3.05c0 .29.2.64.76.53a11.02 11.02 0 0 0 7.51-10.44C23.01 5.24 18.27.5 12 .5Z" />
    </svg>
  );
}
