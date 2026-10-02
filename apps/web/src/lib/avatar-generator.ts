import { createAvatar, type SquishOptions } from "@usespaceui/squishmoji";

/** The same seed and catalogue choices define static and animated faces. */
export const SQUISHMOJI_OPTIONS = {
  shape: "all",
  expression: "all",
  backgroundStyle: "solid",
} satisfies SquishOptions;

/** Static SVG: no animation engine, network request, or fixed dimensions. */
export function generatedAvatar(seed: string): string {
  return createAvatar(seed, SQUISHMOJI_OPTIONS);
}
