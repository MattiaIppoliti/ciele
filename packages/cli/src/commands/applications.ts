import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

/**
 * `ciele applications …` (#839): the Application Connections a Connector Flow
 * action runs through, the action catalogue, and re-consent for a Connection
 * that lacks an action's scopes. Re-consent is a browser round-trip the
 * provider owns, so the verb prints the URL to open rather than pretending to
 * complete it.
 */
export async function applications(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const provider = str(flags.provider);
      const { data } = await client.applications.list(provider || undefined);
      emit(
        table(
          data.map((row) => ({
            id: row.id,
            provider: row.provider,
            name: row.name,
            status: row.status,
            owner: row.ownerType,
            scopes: row.scopes.join(" "),
          })),
          [
            { key: "id", header: "ID" },
            { key: "provider", header: "Provider" },
            { key: "name", header: "Name" },
            { key: "status", header: "Status" },
            { key: "owner", header: "Owner" },
            { key: "scopes", header: "Scopes" },
          ]
        ),
        data
      );
      return EXIT.ok;
    }
    case "connectors": {
      const provider = str(flags.provider);
      const { data } = await client.applications.connectors(provider || undefined);
      emit(
        table(
          data.map((row) => ({
            key: row.key,
            effect: row.effect,
            title: row.title,
            scopes: row.requiredScopes.join(" ") || "-",
          })),
          [
            { key: "key", header: "Action" },
            { key: "effect", header: "Effect" },
            { key: "title", header: "Title" },
            { key: "scopes", header: "Scopes" },
          ]
        ),
        data
      );
      return EXIT.ok;
    }
    case "reconsent": {
      if (!rest[0]) {
        return usage(
          deps,
          "applications reconsent <connectionId> [--actions <key,key>] [--scopes <scope,scope>]"
        );
      }
      const split = (value: string) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      const actions = str(flags.actions);
      const scopes = str(flags.scopes);
      const result = await client.applications.reconsent(rest[0], {
        ...(actions ? { actions: split(actions) } : {}),
        ...(scopes ? { scopes: split(scopes) } : {}),
      });
      emit(
        [
          `Open this URL in a browser signed in to the console to grant ${result.scopes.join(" ")}:`,
          result.startUrl,
        ].join("\n"),
        result
      );
      return EXIT.ok;
    }
    default:
      return usage(deps, "applications <list|connectors|reconsent>");
  }
}
