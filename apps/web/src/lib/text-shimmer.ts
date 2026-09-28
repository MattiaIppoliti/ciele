import type { CSSProperties } from "react";

export const TEXT_SHIMMER_KEYFRAMES =
  "@keyframes beui-text-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}";

/**
 * The sweep stops under `prefers-reduced-motion`, and the text stays readable
 * on the gradient's still frame. Important because the animation itself is an
 * inline style (`textShimmerStyle`), which a plain utility cannot outrank.
 */
export const TEXT_SHIMMER_CLASS_NAME =
  "bg-[length:200%_100%] bg-clip-text text-transparent bg-[linear-gradient(110deg,var(--muted-foreground)_30%,var(--foreground)_50%,var(--muted-foreground)_70%)] motion-reduce:animate-none!";

export function textShimmerStyle(duration: number): CSSProperties {
  return {
    animation: `beui-text-shimmer ${duration}s linear infinite`,
  };
}
