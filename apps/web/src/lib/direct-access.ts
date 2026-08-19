import type { Source } from "@agent-hub/core";

/**
 * The Direct access gating decision (PRD #726): may the widget hand this
 * visitor the file Source's original? Pure, so the widget route stays a thin
 * shell and every leg is unit-tested. All four legs must hold:
 * published assistant ∧ source linked to it with the flag on ∧ file kind ∧
 * retained original. Callers answer a uniform 404 on refusal, never which
 * leg failed.
 */
export function canServeOriginal(input: {
  /** The assistant resolved to a live Publication. */
  published: boolean;
  /** The (assistant, source) link's Direct access flag; null = not linked. */
  linkDirectAccess: boolean | null;
  source: Pick<Source, "kind" | "originalObjectPath"> | null;
}): boolean {
  return (
    input.published &&
    input.linkDirectAccess === true &&
    input.source?.kind === "file" &&
    typeof input.source.originalObjectPath === "string" &&
    input.source.originalObjectPath.length > 0
  );
}
