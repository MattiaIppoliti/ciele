/**
 * The admin shell's `<main>` does not scroll, so each section brings its own
 * scroll container. Without this one the run list and a run's dashboard were
 * cut off at the bottom of the window.
 */
export default function EvalLayout({ children }: { children: React.ReactNode }) {
  return <div className="touch-scroll-clearance h-full overflow-y-auto">{children}</div>;
}
