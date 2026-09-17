import { describe, expect, it } from "vitest";
import type { ConnectorField } from "@agent-hub/core";
import { connectorFieldIdentity } from "./connector-options";

/**
 * A dynamic field's loaded options describe one Connection, one action and one
 * value of the field it depends on. The Connector form keys each field control
 * by this, so React discards the loaded list the moment any of those change —
 * a reset done by identity rather than by clearing state in an effect, which is
 * the same fix and the one React (and this repo's lint) actually allows.
 */
describe("connectorFieldIdentity", () => {
  const field = {
    name: "assignee",
    dynamic: { loader: "servicenow.columns", dependsOn: "table" },
  } satisfies Pick<ConnectorField, "name" | "dynamic">;

  it("changes when the Connection changes", () => {
    expect(connectorFieldIdentity("c1", "create_ticket", field, { table: "incident" })).not.toBe(
      connectorFieldIdentity("c2", "create_ticket", field, { table: "incident" })
    );
  });

  it("changes when the action changes, even for a same-named field", () => {
    expect(connectorFieldIdentity("c1", "create_ticket", field, { table: "incident" })).not.toBe(
      connectorFieldIdentity("c1", "update_ticket", field, { table: "incident" })
    );
  });

  it("changes when the field it depends on changes", () => {
    expect(connectorFieldIdentity("c1", "create_ticket", field, { table: "incident" })).not.toBe(
      connectorFieldIdentity("c1", "create_ticket", field, { table: "problem" })
    );
  });

  it("is stable while nothing that invalidates the options moved", () => {
    expect(connectorFieldIdentity("c1", "create_ticket", field, { table: "incident", other: "x" })).toBe(
      connectorFieldIdentity("c1", "create_ticket", field, { table: "incident", other: "y" })
    );
  });

  it("handles a field with no dynamic loader, and no Connection", () => {
    const plain = { name: "subject" };
    expect(connectorFieldIdentity(null, "create_ticket", plain, {})).toBe(
      connectorFieldIdentity(null, "create_ticket", plain, { table: "incident" })
    );
  });

  it("keeps a fixed loader argument out of the dependency", () => {
    const fixed = {
      name: "assignee",
      dynamic: { loader: "salesforce.fields", arg: "Case" },
    } satisfies Pick<ConnectorField, "name" | "dynamic">;
    expect(connectorFieldIdentity("c1", "create_ticket", fixed, { table: "incident" })).toBe(
      connectorFieldIdentity("c1", "create_ticket", fixed, { table: "problem" })
    );
  });
});
