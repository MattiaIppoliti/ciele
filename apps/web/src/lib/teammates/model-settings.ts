import type { Teammate } from "@agent-hub/core";

type DefaultModel = Pick<Teammate, "modelProvider" | "modelId">;

/** An unrelated settings save must not replace a concurrently changed default. */
export function teammateModelPatch(before: DefaultModel, next: DefaultModel): Partial<DefaultModel> {
  return {
    ...(next.modelProvider !== before.modelProvider ? { modelProvider: next.modelProvider } : {}),
    ...(next.modelId !== before.modelId ? { modelId: next.modelId } : {}),
  };
}
