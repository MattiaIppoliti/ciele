"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/* The custom home cursor pulls in motion/react, which the prior perf work
   (ea88696) deliberately kept off the initial bundle elsewhere. It matters
   only on fine-pointer (mouse) devices, and not before the pointer first
   moves — so load it lazily, mount it after the first pointer activity, and
   never mount it on touch devices (which keep the native cursor). This keeps
   motion out of the home's first-load JS. */
const HomeCursor = dynamic(
  () => import("@/components/home/home-cursor").then((m) => m.HomeCursor),
  { ssr: false },
);

export function HomeCursorMount() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const onFirstMove = () => setReady(true);
    window.addEventListener("pointermove", onFirstMove, {
      once: true,
      passive: true,
    });
    return () => window.removeEventListener("pointermove", onFirstMove);
  }, []);

  return ready ? <HomeCursor /> : null;
}
