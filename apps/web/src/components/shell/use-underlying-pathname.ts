"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

/** Settings opens as a dialog over the page, not as a place of its own. */
const isModalRoute = (pathname: string) => pathname.startsWith("/settings");

/**
 * The page under an open Settings dialog, for navigation that marks "where you
 * are". Settings opened from the Chat is intercepted into a modal and the Chat
 * stays on screen underneath, so the sidebar should keep Chat lit rather than
 * move its marker to a dialog. On a direct visit to `/settings/*` there is no
 * page underneath, and the Settings route itself is where you are.
 */
export function useUnderlyingPathname(): string {
  const pathname = usePathname();
  const [underlying, setUnderlying] = useState(pathname);
  // Adjusted during render, React's pattern for state that follows a prop.
  if (!isModalRoute(pathname) && pathname !== underlying) setUnderlying(pathname);
  return isModalRoute(pathname) && !isModalRoute(underlying) ? underlying : pathname;
}
