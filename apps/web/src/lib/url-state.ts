/**
 * Filters that live in the address bar, so a reload or a copied link lands on
 * the same view. A flat record of strings, compared against its defaults:
 * only what differs is written, which keeps an unfiltered page at a bare URL
 * and lets a default that moves (the rolling 30-day window) keep moving.
 */

/** A flat filter object: every field a string. Interfaces qualify too. */
type FilterRecord<T> = { [K in keyof T]: string };

/** What a page gets from Next.js, or a URLSearchParams. */
type SearchParamsLike =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function read(params: SearchParamsLike, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The defaults with every known key the URL carries laid over them. Keys the
 * defaults do not have are ignored, and a key listed in `allowed` keeps its
 * default unless the URL value is one of the allowed ones, so a hand-edited
 * link cannot put an impossible value into a typed filter.
 */
export function filtersFromSearchParams<T extends FilterRecord<T>>(
  params: SearchParamsLike,
  defaults: T,
  allowed: { [K in keyof T]?: readonly string[] } = {},
): T {
  const result: Record<string, string> = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const value = read(params, key);
    if (value === undefined) continue;
    const options = allowed[key];
    if (options && !options.includes(value)) continue;
    result[key] = value;
  }
  return result as T;
}

/**
 * `base` with the filter keys rewritten: set where the value differs from its
 * default, removed where it does not. Every other parameter is kept.
 */
export function withFilterParams<T extends FilterRecord<T>>(
  base: URLSearchParams,
  values: T,
  defaults: T,
): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const value = values[key];
    if (value && value !== defaults[key]) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

/**
 * Write the filters into the current URL without a navigation. replaceState,
 * not the router: the page already holds the rows, and a router push would
 * refetch the server component to learn nothing new. Next.js keeps
 * useSearchParams in step with native history calls.
 */
export function replaceFilterParams<T extends FilterRecord<T>>(
  values: T,
  defaults: T,
): void {
  const current = new URLSearchParams(window.location.search);
  const next = withFilterParams(current, values, defaults);
  if (next.toString() === current.toString()) return;
  const query = next.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
}
