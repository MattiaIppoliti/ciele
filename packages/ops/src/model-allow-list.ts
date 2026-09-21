import { z } from "zod";
import type { ModelRef, Provider } from "@agent-hub/core";

/**
 * The list of models an Assistant or a Teammate offers its chat window.
 *
 * Not shape-trusted like the structured config beside it: this list decides
 * what an anonymous Visitor may spend the Organization's credits on, so both
 * halves of every entry are checked rather than waved through and sorted out at
 * render time. What it deliberately does *not* check is whether the model
 * exists: the catalogue lives in the runtime package, it moves independently of
 * this one (#893 refreshes it from a feed), and a validator that lagged behind
 * it would refuse an admin a model their Organization can actually run. The
 * turn resolves the entry against the catalogue and the Provider Connections
 * anyway, and an entry that resolves to nothing simply never reaches a picker.
 *
 * The cap is arbitrary and generous. A picker nobody can read is not a feature,
 * and an unbounded list is a row somebody can grow forever.
 */
export const allowedModelsSchema = z
  .array(
    z.object({
      provider: z.custom<Provider>((v) => typeof v === "string"),
      modelId: z.string().min(1).max(200),
    })
  )
  .max(24) satisfies z.ZodType<ModelRef[], ModelRef[]>;
