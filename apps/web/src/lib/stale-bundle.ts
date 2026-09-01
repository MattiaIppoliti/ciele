/**
 * Is this the error a version-skewed tab produces?
 *
 * A console tab left open across a deploy keeps the old runtime. Its first
 * soft navigation into a route it never loaded asks the new deployment for a
 * module the old runtime cannot fetch or link, and the browser or Turbopack's
 * runtime says so in one of these shapes. A throw from the app's own code never
 * carries them, which is what lets the root error boundary reload once for a
 * stale tab without ever reloading over a real bug.
 */
export function isStaleBundleError(error: {
  name?: string;
  message?: string;
}): boolean {
  if (error.name === "ChunkLoadError") return true;
  return /Loading chunk|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed|Cannot find module|Module not found/i.test(
    error.message ?? ""
  );
}
