"use client";

import { usePathname } from "next/navigation";

/**
 * Renders an intercepted modal only while the URL is still one of its routes.
 *
 * A parallel slot keeps its last state across a soft navigation it does not
 * match: follow a link out of Settings to another page and, without this, the
 * Settings dialog would stay open over it. Back and forward restore the slot
 * from history and need nothing; this covers the forward links.
 */
export function ModalRouteGate({
  prefix,
  children,
}: {
  prefix: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return pathname.startsWith(prefix) ? children : null;
}
