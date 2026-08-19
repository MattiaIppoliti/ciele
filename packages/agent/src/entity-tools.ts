import { z } from "zod";
import type {
  EntityAttributeType,
  EntityRecord,
  EntityRecordQuery,
  EntitySnapshot,
  KnowledgeSearchResult,
} from "@agent-hub/core";
import type { RuntimeToolSpec } from "./tools";
import type { EntityRecordsFetcher } from "./types";

/**
 * Auto-generated Entity retrieval tools (#665), the config-to-schema pattern
 * (see `customToolSpec`) applied to the org's structured business data: each
 * **shared** Entity the assistant selected yields
 *
 *   - a filter tool (`filter<Name>`), one typed optional input per attribute,
 *     equality-matched against Record values, and
 *   - a text-search tool (`search<Name>`), keyword over the Record's values,
 *     generated only when the Entity has text attributes to search.
 *
 * The tool *set* rides the Publication snapshot (an EntitySnapshot list built
 * at publish time), while `execute` reads Record content live through the
 * fetcher the Conversation Turn binds over the Db seam.
 *
 * User-scoped Entities (#667) additionally take an `identity` binding: the
 * Entity's identity attribute is removed from the model-facing input schema
 * and force-set server-side to the turn's verified claim value on every
 * query, a model-supplied value for it is discarded, never honored. Without
 * an identity binding a user-scoped Entity yields no tools (fail safe).
 */

export type { EntityRecordsFetcher } from "./types";

/** Results handed back to the model per tool call. */
const RESULT_LIMIT = 20;

const zodForAttribute: Record<EntityAttributeType, () => z.ZodType> = {
  text: () => z.string(),
  number: () => z.number(),
  date: () => z.string(),
  boolean: () => z.boolean(),
};

/**
 * "Product catalog!" → "ProductCatalog": a tool-name fragment the model can
 * call (`TOOL_NAME_RE`-safe). Empty when the name has no usable characters,
 * the caller then skips the Entity rather than inventing a name.
 */
export function entityToolNameFragment(name: string): string {
  return name
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 48);
}

function describeEntity(entity: EntitySnapshot): string {
  return entity.description.trim() || entity.name;
}

/**
 * The citation an answered Entity query contributes (same pattern as the API
 * catalogue's `apiSource`, #559): namespaced so it can never collide with a
 * real Concept id, and stable per Entity so ten queries of one Entity cite
 * once (`dedupSources`). No URL, the chip names the data, it does not hand a
 * Visitor an internal surface to click. A Record-grounded answer without this
 * showed no Sources at all, which read as ungrounded.
 */
export function entityCitation(entity: EntitySnapshot): KnowledgeSearchResult {
  return {
    conceptId: `entity:${entity.id}`,
    conceptTitle: entity.name,
    conceptPath: "",
    collectionId: "",
    collectionName: "Records",
    sourceName: entity.name,
    resourceUrl: null,
    content: "",
    similarity: 1,
  };
}

/** Projects matched Records to the model-facing shape (values only). */
function project(records: EntityRecord[]) {
  return {
    count: records.length,
    records: records.map((r) => r.values),
    ...(records.length === 0
      ? { note: "No matching records. Tell the user honestly if you cannot answer from the data." }
      : {}),
  };
}

/**
 * A server-side identity binding for a user-scoped Entity (#667): every
 * query the tools run is constrained to Records whose identity attribute
 * equals the turn's verified claim value. Non-model-controllable.
 */
export interface EntityIdentityBinding {
  value: string;
}

/**
 * The specs one Entity yields. Returns [] for an Entity whose name yields no
 * valid tool name; the search tool is omitted when nothing is text-typed.
 * A user-scoped Entity yields tools only with an identity binding, and the
 * bound attribute never appears in the model-facing schema.
 */
export function entityToolSpecs(
  entity: EntitySnapshot,
  fetch: EntityRecordsFetcher,
  identity?: EntityIdentityBinding | null,
  options?: {
    /**
     * Member-grade access (#668): a user-scoped Entity yields CROSS-RECORD
     * tools, the identity filter is omitted and the identity attribute
     * becomes an ordinary filterable attribute. Only the org-staff data
     * assistant's member turns set this; Widget turns never do.
     */
    crossRecord?: boolean;
    /**
     * Receives the {@link entityCitation} whenever a query returned Records,
     * the turn wires this to its `usedSources` collector so Record-grounded
     * answers carry a Sources chip like knowledge- and API-grounded ones.
     */
    cite?: (source: KnowledgeSearchResult) => void;
  }
): RuntimeToolSpec[] {
  const fragment = entityToolNameFragment(entity.name);
  if (!fragment || entity.attributes.length === 0) return [];
  const bound =
    entity.scope === "user"
      ? entity.identityAttribute && identity?.value
        ? { attribute: entity.identityAttribute, value: identity.value }
        : undefined
      : undefined;
  const crossRecord =
    entity.scope === "user" && !bound && options?.crossRecord === true;
  if (entity.scope !== "shared" && !bound && !crossRecord) return [];

  const filterShape: Record<string, z.ZodType> = {};
  for (const attribute of entity.attributes) {
    if (!attribute.key) continue;
    // The identity-bound attribute is server-controlled: it never appears in
    // the schema, and execute() overwrites any smuggled value regardless.
    if (attribute.key === bound?.attribute) continue;
    filterShape[attribute.key] = zodForAttribute[attribute.type]()
      .describe(`${attribute.label || attribute.key} (exact match)`)
      .optional();
  }

  const specs: RuntimeToolSpec[] = [
    {
      name: `filter${fragment}`,
      description: `Look up "${entity.name}" records (${describeEntity(entity)}) by exact attribute values. Provide one or more attributes to filter by; results come from the organization's live data.`,
      inputSchema: z.object(filterShape),
      label: () => `Looking up ${entity.name}`,
      summarize: (output) => {
        const o = output as { count?: number };
        return typeof o?.count === "number" ? `${o.count} records` : undefined;
      },
      async execute(input) {
        const filters: EntityRecordQuery["filters"] = {};
        for (const attribute of entity.attributes) {
          const value = input[attribute.key];
          if (value === undefined || value === null || value === "") continue;
          filters[attribute.key] = value as string | number | boolean;
        }
        // Identity binding last: it wins over anything the model supplied.
        if (bound) filters[bound.attribute] = bound.value;
        const records = await fetch(entity.id, { filters, limit: RESULT_LIMIT });
        if (records.length > 0) options?.cite?.(entityCitation(entity));
        return project(records);
      },
    },
  ];

  if (entity.attributes.some((a) => a.type === "text")) {
    specs.push({
      name: `search${fragment}`,
      description: `Search "${entity.name}" records (${describeEntity(entity)}) by keyword across their text attributes. Use when you don't know exact attribute values.`,
      inputSchema: z.object({
        query: z.string().describe("Keyword(s) to search for"),
      }),
      label: (input) => `Searching ${entity.name} for “${String(input.query ?? "")}”`,
      summarize: (output) => {
        const o = output as { count?: number };
        return typeof o?.count === "number" ? `${o.count} records` : undefined;
      },
      async execute(input) {
        const records = await fetch(entity.id, {
          search: String(input.query ?? ""),
          ...(bound ? { filters: { [bound.attribute]: bound.value } } : {}),
          limit: RESULT_LIMIT,
        });
        if (records.length > 0) options?.cite?.(entityCitation(entity));
        return project(records);
      },
    });
  }

  return specs;
}
