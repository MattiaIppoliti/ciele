export type LinkPrefetchMode = "none" | "intent" | "viewport";

type PrefetchSetting = boolean | "auto" | null | undefined;

export interface PrefetchRouter {
  prefetch: (href: string) => void;
}

const DEDUPE_WINDOW_MS = 30_000;

/** Policy shared by Link and its regression tests. */
export function getLinkPrefetchMode(
  href: string | null,
  prefetch: PrefetchSetting,
): LinkPrefetchMode {
  if (href === null || !href.startsWith("/") || prefetch === false) {
    return "none";
  }
  return prefetch === true ? "viewport" : "intent";
}

/**
 * Deduplicates hover/focus requests per destination for a short intent window.
 * The entry naturally expires, so a later interaction can refresh stale data
 * without coupling this wrapper to Next.js' internal prefetch option types.
 */
export function createPrefetchRequester(now: () => number = Date.now) {
  const prefetchedAt = new Map<string, number>();

  return (router: PrefetchRouter, href: string) => {
    const requestedAt = prefetchedAt.get(href);
    const currentTime = now();
    if (
      requestedAt !== undefined &&
      currentTime - requestedAt < DEDUPE_WINDOW_MS
    ) {
      return;
    }
    prefetchedAt.set(href, currentTime);
    try {
      router.prefetch(href);
    } catch (error) {
      prefetchedAt.delete(href);
      throw error;
    }
  };
}
