import { z } from "zod";
import type { ZodType } from "zod";
import {
  assistantPatchSchema,
  createAssistantOp,
  createFaqOp,
  flowInputSchema,
  flowPatchSchema,
  improvementPatchSchema,
} from "@ciele/ops";
import { API_V1_DOMAINS, API_V1_VERSION } from "@/lib/api-v1/meta";

/**
 * The /api/v1 contract registry (#626): one entry per shipped endpoint.
 *
 * This is the single list three things read:
 * - `buildOpenApiDocument()` turns it into the OpenAPI 3.1 document served
 *   at `GET /api/v1/openapi.json` (request bodies rendered from the same
 *   zod schemas the operations validate with — the contract cannot say
 *   something the server doesn't enforce);
 * - the drift test (`openapi.test.ts`) diffs it against the route files on
 *   disk, so shipping a route without registering it (or vice versa) fails
 *   CI;
 * - `@ciele/client` mirrors it method-for-method.
 */

export interface EndpointSpec {
  method: "get" | "post" | "patch" | "delete";
  /** OpenAPI-style path relative to /api/v1, e.g. "/assistants/{id}". */
  path: string;
  summary: string;
  /** Zod schema of the JSON request body, when the endpoint takes one. */
  body?: ZodType;
  /** Multipart endpoints document their form fields instead of a body. */
  multipart?: string[];
  /** False only for the discovery endpoints. */
  auth?: boolean;
  /** Honors the Idempotency-Key header. */
  idempotent?: boolean;
}

const reorderBody = z.object({ orderedIds: z.array(z.string()) });
const republishBody = z.object({ publicationId: z.string() });
const exportBody = z.object({ conversationIds: z.array(z.string()) });
const faqBody = createFaqOp.input;
const sourceBody = z.union([
  z.object({
    kind: z.literal("text"),
    name: z.string().optional(),
    text: z.string(),
  }),
  z.object({ kind: z.literal("url"), url: z.string() }),
]);

export const API_V1_ENDPOINTS: EndpointSpec[] = [
  { method: "get", path: "/meta", summary: "Discovery: API version, server version, shipped domains", auth: false },
  { method: "get", path: "/openapi.json", summary: "This document", auth: false },
  { method: "get", path: "/whoami", summary: "The key's Organization, Role and id" },

  // Assistants (#620)
  { method: "get", path: "/assistants", summary: "List Assistants (cursor pagination)" },
  { method: "post", path: "/assistants", summary: "Create an Assistant", body: createAssistantOp.input, idempotent: true },
  { method: "get", path: "/assistants/{id}", summary: "One Assistant" },
  { method: "patch", path: "/assistants/{id}", summary: "Update an Assistant", body: assistantPatchSchema },
  { method: "delete", path: "/assistants/{id}", summary: "Delete an Assistant (admin+)" },
  { method: "post", path: "/assistants/{id}/duplicate", summary: "Duplicate: config + Flows; knowledge stays", idempotent: true },

  // Flows (#621)
  { method: "get", path: "/assistants/{id}/flows", summary: "An Assistant's ordered Flow list" },
  { method: "post", path: "/assistants/{id}/flows", summary: "Create a Flow", body: flowInputSchema, idempotent: true },
  { method: "post", path: "/assistants/{id}/flows/reorder", summary: "Reorder Flows (Default stays last)", body: reorderBody },
  { method: "get", path: "/flows/{id}", summary: "One Flow (full router config)" },
  { method: "patch", path: "/flows/{id}", summary: "Update a Flow (incl. enable/disable)", body: flowPatchSchema },
  { method: "delete", path: "/flows/{id}", summary: "Delete a Flow (Default behavior refuses, 409)" },

  // Knowledge (#622)
  { method: "get", path: "/assistants/{id}/collections", summary: "An Assistant's Knowledge Collections" },
  { method: "get", path: "/collections/{id}/sources", summary: "A Collection's Sources (with status)" },
  { method: "post", path: "/collections/{id}/sources", summary: "Add a Source: JSON text/url, or multipart file", body: sourceBody, multipart: ["file"], idempotent: true },
  { method: "post", path: "/collections/{id}/faqs", summary: "Add one FAQ", body: faqBody, idempotent: true },
  { method: "post", path: "/collections/{id}/faqs/import", summary: "Bulk FAQ import (CSV)", multipart: ["file"] },
  { method: "get", path: "/sources/{id}", summary: "One Source — poll status until it settles" },
  { method: "delete", path: "/sources/{id}", summary: "Delete a Source (Concepts cascade)" },
  { method: "post", path: "/sources/{id}/recrawl", summary: "Restart a website Source's crawl" },

  // Publish (#623)
  { method: "get", path: "/assistants/{id}/publish", summary: "Publication status" },
  { method: "post", path: "/assistants/{id}/publish", summary: "Publish a new snapshot (admin+)", idempotent: true },
  { method: "delete", path: "/assistants/{id}/publish", summary: "Unpublish (admin+)" },
  { method: "post", path: "/assistants/{id}/republish", summary: "Re-activate an earlier Publication (admin+)", body: republishBody, idempotent: true },

  // Inbox (#624, read-only)
  { method: "get", path: "/conversations", summary: "List Conversations (?assistantId= filter)" },
  { method: "get", path: "/conversations/{id}", summary: "One transcript (trace gated by Role)" },
  { method: "post", path: "/conversations/export", summary: "29-field export records", body: exportBody },

  // Improvements (#625)
  { method: "get", path: "/improvements", summary: "The Improvements kanban" },
  { method: "get", path: "/improvements/{id}", summary: "One Improvement (associations + proposal)" },
  { method: "patch", path: "/improvements/{id}", summary: "Update an Improvement", body: improvementPatchSchema },
];

const ERROR_SCHEMA = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" } },
      required: ["code", "message"],
    },
  },
  required: ["error"],
} as const;

function pathParams(path: string) {
  return [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: "path" as const,
    required: true,
    schema: { type: "string" as const },
  }));
}

/** The served document. Kept dependency-free: zod v4 renders JSON Schema. */
export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of API_V1_ENDPOINTS) {
    const entry: Record<string, unknown> = {
      summary: endpoint.summary,
      parameters: pathParams(endpoint.path),
      security: endpoint.auth === false ? [] : [{ apiKey: [] }],
      responses: {
        "2XX": { description: "Success" },
        "4XX": {
          description: "Error envelope",
          content: { "application/json": { schema: ERROR_SCHEMA } },
        },
      },
    };
    const content: Record<string, unknown> = {};
    if (endpoint.body) {
      content["application/json"] = {
        // Structured config fields validated with z.custom (quick replies,
        // flow settings) have no JSON-Schema form — they render as {} (any).
        schema: z.toJSONSchema(endpoint.body, {
          io: "input",
          target: "draft-7",
          unrepresentable: "any",
        }),
      };
    }
    if (endpoint.multipart) {
      content["multipart/form-data"] = {
        schema: {
          type: "object",
          properties: Object.fromEntries(
            endpoint.multipart.map((f) => [f, { type: "string", format: "binary" }])
          ),
        },
      };
    }
    if (Object.keys(content).length > 0) {
      entry.requestBody = { required: true, content };
    }
    (paths[`/api/v1${endpoint.path}`] ??= {})[endpoint.method] = entry;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "ciele API",
      version: `${API_V1_VERSION}.0.0`,
      description: `Org-scoped admin API. Authenticate with an API key (Bearer ciele_sk_…). Domains: ${API_V1_DOMAINS.join(", ")}.`,
    },
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", bearerFormat: "ciele_sk_…" },
      },
    },
    paths,
  };
}
