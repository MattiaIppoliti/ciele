"use client";

import NextLink from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

import {
  createPrefetchRequester,
  getLinkPrefetchMode,
} from "@/components/ui/link-prefetch";

type LinkProps = ComponentProps<typeof NextLink>;

const requestPrefetch = createPrefetchRequester();

/**
 * Drop-in replacement for next/link with intent-first prefetching:
 *
 * - Internal string hrefs prefetch on hover/focus by default.
 * - `prefetch={true}` explicitly enables Next.js viewport prefetching too.
 * - `prefetch={false}` disables both viewport and intent prefetching.
 * - Navigation keeps Next.js' standard click semantics; modified clicks,
 *   drag/cancel gestures and composed controls remain native.
 *
 * Non-string and external hrefs pass their prefetch setting straight through.
 */
export const Link = (({
  prefetch,
  onMouseEnter,
  onFocus,
  ...props
}: LinkProps) => {
  const router = useRouter();
  const href = typeof props.href === "string" ? props.href : null;
  const managed = href !== null && href.startsWith("/");
  const mode = getLinkPrefetchMode(href, prefetch);
  const prefetchOnIntent = mode === "intent";

  return (
    <NextLink
      {...props}
      prefetch={managed ? mode === "viewport" : prefetch}
      onMouseEnter={(event) => {
        if (prefetchOnIntent && href !== null) requestPrefetch(router, href);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        if (prefetchOnIntent && href !== null) requestPrefetch(router, href);
        onFocus?.(event);
      }}
    />
  );
}) as typeof NextLink;
