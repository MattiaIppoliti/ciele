/**
 * A lazily imported module, fetched once and shared.
 *
 * One promise, so an idle fetch, a hover and the render all share a request.
 * A failed fetch is forgotten, so the next attempt retries instead of
 * replaying the failure. Pass the `import()` itself, written out at the call
 * site, so the bundler still splits the module into its own chunk.
 *
 * Why not `next/dynamic`: a lazy component suspends on its first render even
 * when its code is already here, and React holds a revealed Suspense boundary
 * back by its fallback throttle (300ms) so a fast network does not flash.
 * That throttle was the whole of the live Preview's first-open pause, 350ms
 * against 49ms for every open after it. Rendering `loaded()` directly never
 * suspends, so there is nothing to throttle.
 */
export function createPreloader<Module>(importModule: () => Promise<Module>) {
  let pending: Promise<Module> | null = null;
  let loaded: Module | null = null;

  function load() {
    pending ??= importModule().then(
      (module) => (loaded = module),
      (error: unknown) => {
        pending = null;
        throw error;
      }
    );
    return pending;
  }

  return {
    load,
    /** The module, synchronously, once the fetch has landed; null before. */
    loaded: () => loaded,
    /** Fire-and-forget form, for hover and idle callbacks. */
    prefetch: () => {
      load().catch(() => {
        // The render retries and surfaces the failure there.
      });
    },
  };
}
