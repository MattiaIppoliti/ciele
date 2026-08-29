// Which Provider Connections can embed, the one fact the settings UI needs
// from the runtime to offer the org-level embedding picker (#437).
//
// Deliberately pure and dependency-free (no AI SDK, no credentials) so it is
// safe on both sides of the client barrel: `embeddings.ts` builds the actual
// model from a connection, this only answers whether it could.

import type { ProviderConnection } from "@agent-hub/core";

/**
 * True when this connection could produce embeddings.
 *
 * - `openai` / `google`, first-party embeddings APIs.
 * - `openai_compatible`: only when the endpoint declares an embedding model;
 *   a chat-only endpoint (the common Ollama setup) cannot embed.
 * - `anthropic` has no embeddings API; `azure_openai` is chat-only here.
 *
 * A connection that cannot embed must never be offered as the org's embedding
 * choice: the runtime treats the choice as authoritative and falls back to
 * lexical search rather than silently embedding with another model.
 */
export function canEmbedWithConnection(connection: ProviderConnection): boolean {
  switch (connection.provider) {
    case "openai":
    case "google":
      return true;
    case "openai_compatible":
      return Boolean(
        connection.config.kind === "openai_compatible" &&
          connection.config.embeddingModel
      );
    default:
      return false;
  }
}
