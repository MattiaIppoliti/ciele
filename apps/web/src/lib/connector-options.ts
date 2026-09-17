import type { ApplicationConnection, ConnectorField } from "@agent-hub/core";

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

/**
 * What a dynamic connector field's loaded options belong to: one Connection,
 * one action, and one value of the field this one depends on.
 *
 * The Connector form keys each field control by this string, so changing any of
 * them gives React a different element and the stale option list goes with the
 * old one. A reset by identity rather than by clearing state inside an effect,
 * which is the same behaviour and the one React prefers (and the repo's lint
 * enforces). A fixed `arg` is part of the field, not of the form's state, so it
 * is deliberately not folded in: it cannot change without the field changing.
 */
export function connectorFieldIdentity(
  connectionId: string | null,
  actionKey: string,
  field: Pick<ConnectorField, "name" | "dynamic">,
  params: Record<string, string>
): string {
  const dependsOn = field.dynamic?.dependsOn;
  const arg = dependsOn ? (params[dependsOn] ?? "") : "";
  return `${connectionId ?? ""}:${actionKey}:${field.name}:${arg}`;
}
