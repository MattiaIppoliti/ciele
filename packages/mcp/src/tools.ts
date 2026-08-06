import { z, type ZodRawShape } from "zod";
import type { CieleClient } from "@ciele/client";

/**
 * The ciele MCP tool set (#629): coarse domain tools with an `action`
 * discriminator — 7 tools, not one per endpoint, so an agent picks reliably.
 * Every v1-perimeter operation is reachable through one of these.
 *
 * Handlers return plain JSON-able data; the server layer (server.ts) wraps
 * it as MCP content, applies the read-only guard, and turns thrown
 * `ToolInputError`s / `CieleApiError`s into error results.
 */

/** A caller-attributable input problem (missing field for the action). */
export class ToolInputError extends Error {}

export interface CieleTool {
  name: string;
  description: string;
  schema: ZodRawShape;
  /** Whether this call would write — the read-only mode gate. */
  mutates(args: Record<string, unknown>): boolean;
  run(args: Record<string, unknown>): Promise<unknown>;
}

function need(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolInputError(`"${key}" is required for this action`);
  }
  return value;
}

const READ_ACTIONS = new Set([
  "list",
  "get",
  "status",
  "list_collections",
  "list_sources",
  "get_source",
  "export",
]);

const byAction = (args: Record<string, unknown>) =>
  !READ_ACTIONS.has(String(args.action));

export function buildTools(client: CieleClient): CieleTool[] {
  return [
    {
      name: "ciele_identity",
      description:
        "Who and where you are: the deployment's API version and shipped domains, plus the Organization and Role this API key acts with. Call this first to learn what you may do.",
      schema: {},
      mutates: () => false,
      run: async () => ({
        meta: await client.meta(),
        whoami: await client.whoami(),
      }),
    },
    {
      name: "manage_assistants",
      description:
        "List, read, create, update, duplicate or delete the Organization's Assistants. `list` supports limit/cursor; `update` takes a `patch` object (title, nickname, description, answeringStyle, welcomeMessage, …); `duplicate` copies config + flows (knowledge stays); `delete` is permanent and needs an admin-tier key.",
      schema: {
        action: z.enum(["list", "get", "create", "update", "delete", "duplicate"]),
        id: z.string().optional().describe("Assistant id (get/update/delete/duplicate)"),
        title: z.string().optional().describe("Title (create)"),
        nickname: z.string().optional(),
        description: z.string().optional(),
        patch: z.record(z.string(), z.unknown()).optional().describe("Fields to change (update)"),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      },
      mutates: byAction,
      run: async (args) => {
        switch (args.action) {
          case "list":
            return client.assistants.list({
              limit: args.limit as number | undefined,
              cursor: args.cursor as string | undefined,
            });
          case "get":
            return client.assistants.get(need(args, "id"));
          case "create":
            return client.assistants.create({
              title: need(args, "title"),
              nickname: args.nickname as string | undefined,
              description: args.description as string | undefined,
            });
          case "update":
            if (!args.patch) throw new ToolInputError('"patch" is required for update');
            return client.assistants.update(need(args, "id"), args.patch);
          case "delete":
            await client.assistants.delete(need(args, "id"));
            return { deleted: args.id };
          case "duplicate":
            return client.assistants.duplicate(need(args, "id"));
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_flows",
      description:
        "The Assistant's routing: list an Assistant's Flows, read one (full trigger/conditions/actions config), create, update (incl. enabled true/false), reorder, or delete. The Default behavior flow is locked and cannot be deleted. `flow` carries the FlowInput/FlowPatch body for create/update.",
      schema: {
        action: z.enum(["list", "get", "create", "update", "delete", "reorder"]),
        assistantId: z.string().optional().describe("Required for list/create/reorder"),
        id: z.string().optional().describe("Flow id (get/update/delete)"),
        flow: z.record(z.string(), z.unknown()).optional().describe("FlowInput (create) / FlowPatch (update)"),
        orderedIds: z.array(z.string()).optional().describe("Full order for reorder; Default stays last"),
      },
      mutates: byAction,
      run: async (args) => {
        switch (args.action) {
          case "list":
            return client.flows.list(need(args, "assistantId"));
          case "get":
            return client.flows.get(need(args, "id"));
          case "create":
            if (!args.flow) throw new ToolInputError('"flow" is required for create');
            return client.flows.create(
              need(args, "assistantId"),
              args.flow as never
            );
          case "update":
            if (!args.flow) throw new ToolInputError('"flow" is required for update');
            return client.flows.update(need(args, "id"), args.flow as never);
          case "delete":
            await client.flows.delete(need(args, "id"));
            return { deleted: args.id };
          case "reorder":
            if (!Array.isArray(args.orderedIds)) {
              throw new ToolInputError('"orderedIds" is required for reorder');
            }
            return client.flows.reorder(
              need(args, "assistantId"),
              args.orderedIds as string[]
            );
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_knowledge",
      description:
        "The Assistant's knowledge base: list an Assistant's Collections, list/read a Collection's Sources (poll get_source until status leaves 'processing'), add sources (text, url, or a file passed as base64), delete a source, re-crawl a website source, add one FAQ, or bulk-import FAQs from CSV text (columns: question,answer).",
      schema: {
        action: z.enum([
          "list_collections",
          "list_sources",
          "get_source",
          "add_text",
          "add_url",
          "add_file",
          "delete_source",
          "recrawl",
          "add_faq",
          "import_faqs",
        ]),
        assistantId: z.string().optional().describe("Required for list_collections"),
        collectionId: z.string().optional().describe("Required for list_sources/add_*/import_faqs"),
        sourceId: z.string().optional().describe("Required for get_source/delete_source/recrawl"),
        name: z.string().optional().describe("Source name (add_text) / file name (add_file)"),
        text: z.string().optional().describe("Raw text (add_text)"),
        url: z.string().optional().describe("Page URL (add_url)"),
        fileBase64: z.string().optional().describe("File bytes, base64 (add_file)"),
        question: z.string().optional(),
        answer: z.string().optional(),
        csvText: z.string().optional().describe("CSV content (import_faqs)"),
      },
      mutates: byAction,
      run: async (args) => {
        switch (args.action) {
          case "list_collections":
            return client.knowledge.collections(need(args, "assistantId"));
          case "list_sources":
            return client.knowledge.sources(need(args, "collectionId"));
          case "get_source":
            return client.knowledge.getSource(need(args, "sourceId"));
          case "add_text":
            return client.knowledge.addTextSource(need(args, "collectionId"), {
              name: args.name as string | undefined,
              text: need(args, "text"),
            });
          case "add_url":
            return client.knowledge.addUrlSource(
              need(args, "collectionId"),
              need(args, "url")
            );
          case "add_file": {
            const bytes = Buffer.from(need(args, "fileBase64"), "base64");
            return client.knowledge.addFileSource(
              need(args, "collectionId"),
              new File([bytes], (args.name as string) || "upload.bin")
            );
          }
          case "delete_source":
            await client.knowledge.deleteSource(need(args, "sourceId"));
            return { deleted: args.sourceId };
          case "recrawl":
            return client.knowledge.recrawlSource(need(args, "sourceId"));
          case "add_faq":
            return client.knowledge.addFaq(need(args, "collectionId"), {
              question: need(args, "question"),
              answer: need(args, "answer"),
            });
          case "import_faqs":
            return client.knowledge.importFaqs(
              need(args, "collectionId"),
              new File([need(args, "csvText")], "faqs.csv", { type: "text/csv" })
            );
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "publish_assistant",
      description:
        "Publication lifecycle (admin-tier key for writes): `status` (is it live, which version), `publish` (freeze the current config into a new immutable snapshot and serve it), `unpublish` (take the widget offline), `republish` (roll back to an earlier publicationId).",
      schema: {
        action: z.enum(["status", "publish", "unpublish", "republish"]),
        assistantId: z.string(),
        publicationId: z.string().optional().describe("Required for republish"),
      },
      mutates: byAction,
      run: async (args) => {
        const assistantId = need(args, "assistantId");
        switch (args.action) {
          case "status":
            return client.publish.status(assistantId);
          case "publish":
            return client.publish.publish(assistantId);
          case "unpublish":
            await client.publish.unpublish(assistantId);
            return { unpublished: assistantId };
          case "republish":
            return client.publish.republish(assistantId, need(args, "publicationId"));
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "read_inbox",
      description:
        "Review end-user Conversations, read-only: `list` (optionally filtered by assistantId, cursor-paginated), `get` one transcript (thinking traces appear only for admin-tier keys), `export` the reference-parity 29-field records for a list of conversation ids.",
      schema: {
        action: z.enum(["list", "get", "export"]),
        conversationId: z.string().optional().describe("Required for get"),
        conversationIds: z.array(z.string()).optional().describe("Required for export"),
        assistantId: z.string().optional(),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      },
      mutates: () => false,
      run: async (args) => {
        switch (args.action) {
          case "list":
            return client.conversations.list({
              assistantId: args.assistantId as string | undefined,
              limit: args.limit as number | undefined,
              cursor: args.cursor as string | undefined,
            });
          case "get":
            return client.conversations.get(need(args, "conversationId"));
          case "export":
            if (!Array.isArray(args.conversationIds)) {
              throw new ToolInputError('"conversationIds" is required for export');
            }
            return client.conversations.export(args.conversationIds as string[]);
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
    {
      name: "manage_improvements",
      description:
        "The answer-quality kanban: `list` items, `get` one (with the flagged messages and any drafted fix), `update` status/priority/tags/assigneeId/dueDate/title/description via `patch` — e.g. move a card to in_progress or done.",
      schema: {
        action: z.enum(["list", "get", "update"]),
        id: z.string().optional().describe("Improvement id (get/update)"),
        patch: z.record(z.string(), z.unknown()).optional().describe("ImprovementPatch (update)"),
        limit: z.number().optional(),
        cursor: z.string().optional(),
      },
      mutates: byAction,
      run: async (args) => {
        switch (args.action) {
          case "list":
            return client.improvements.list({
              limit: args.limit as number | undefined,
              cursor: args.cursor as string | undefined,
            });
          case "get":
            return client.improvements.get(need(args, "id"));
          case "update":
            if (!args.patch) throw new ToolInputError('"patch" is required for update');
            return client.improvements.update(need(args, "id"), args.patch as never);
          default:
            throw new ToolInputError(`Unknown action "${args.action}"`);
        }
      },
    },
  ];
}
