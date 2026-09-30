/**
 * A dynamically imported module, fetched once and shared.
 *
 * One promise, so an idle warm-up, a hover and the render all share a request.
 * A failed fetch is forgotten, so the next attempt retries instead of
 * replaying the failure. `get` hands the module back synchronously once it
 * has landed, which is what lets a launcher render the component directly
 * instead of through `next/dynamic` (see `preview-panel-loader.ts`).
 *
 * Pass the `import()` as a literal arrow at the call site, so the bundler
 * still sees the dynamic import and splits the module out.
 */
export function lazyModule<M>(importer: () => Promise<M>) {
  let pending: Promise<M> | null = null;
  let loaded: M | null = null;

  function load() {
    pending ??= importer().then(
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
    get: () => loaded,
    /** Fire-and-forget form, for hover and idle callbacks. */
    prefetch: () => {
      load().catch(() => {
        // The render retries and surfaces the failure there.
      });
    },
  };
}
