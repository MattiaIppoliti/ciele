/**
 * A React key for a static sibling in a layout, in development only.
 *
 * Static siblings need no key. React 19's dev-only key check still warns on
 * them ("Check the render method of `OuterLayoutRouter`") when the RSC payload
 * is large enough to stream them as separate chunks, on every full page load.
 * Production runs no such check, so a key there would only be bytes: the root
 * layout's keys are written into every prerendered document, and they tipped
 * the RSC document budget (`measure:document`) over by 1.2 KB. Undefined in
 * production, so the payload is what it was before the fix.
 */
export function devKey(name: string): string | undefined {
  return process.env.NODE_ENV === "production" ? undefined : name;
}
