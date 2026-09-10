import type { ApplicationConnection } from "@agent-hub/core";

/**
 * The Application Connection shape a Client Component may see (#839): the
 * fields the Connector and Human review pickers render, never the sealed
 * credential. Its own module rather than a type on the picker component so the
 * server-side catalogue loader (`flow-builder-catalogue.ts`, imported by the
 * Flows Agent route) never depends on a `"use client"` file.
 */
export type ConnectorConnectionOption = Pick<
  ApplicationConnection,
  "id" | "provider" | "name" | "status" | "scopes" | "ownerType"
>;
