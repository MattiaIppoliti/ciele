"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * A `Link` that prefetches when the pointer or focus reaches it instead of when
 * it scrolls into view.
 *
 * A settings rail is nine links that are all in view the moment the dialog
 * opens, and each prefetch of a dynamic route is a server render that resolves
 * the session and its Organization. Nine of those at once, on every console page
 * that shows the sidebar's Settings group, queue ahead of the click that
 * actually matters. Hover comes before a click by long enough to hide most of
 * it, and a tap on touch pays what it always paid.
 */
export function IntentLink({
  onPointerEnter,
  onFocus,
  href,
  ...props
}: ComponentProps<typeof Link>) {
  const router = useRouter();
  const warm = () => {
    if (typeof href === "string") router.prefetch(href);
  };
  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onPointerEnter={(event) => {
        warm();
        onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        warm();
        onFocus?.(event);
      }}
    />
  );
}
