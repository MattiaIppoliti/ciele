import { EXIT } from "../index.ts";
import { usage, type CommandContext } from "./shared.ts";
import { readFileSync } from "node:fs";
import { str } from "./shared.ts";

export async function sso(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, emit, deps } = ctx;
  switch (verb) {
    case "status": {
      const identity = await client.sso.identity();
      emit(JSON.stringify(identity, null, 2), identity);
      return EXIT.ok;
    }
    case "identity": {
      if (!rest[0]) return usage(deps, "sso identity <claim|none>");
      const identityClaim = rest[0] === "none" ? null : rest[0];
      const result = await client.sso.setIdentityClaim(identityClaim);
      emit(
        result.identityClaim
          ? `SSO identity claim set to ${result.identityClaim}`
          : "SSO identity claim cleared",
        result
      );
      return EXIT.ok;
    }
    case "validate": {
      const result = await client.sso.validate();
      emit(result.ok ? "SSO connection is valid" : `SSO validation failed: ${result.error}`, result);
      return result.ok ? EXIT.ok : EXIT.error;
    }
    case "connect": {
      const file = str(ctx.flags.file);
      if (!file) return usage(deps, "sso connect --file <connection.json>");
      const result = await client.sso.connect(
        JSON.parse(readFileSync(file, "utf8")) as Parameters<typeof client.sso.connect>[0]
      );
      emit("SSO connection saved", result);
      return EXIT.ok;
    }
    case "connection": {
      const result = await client.sso.connection();
      emit(JSON.stringify(result, null, 2), result);
      return EXIT.ok;
    }
    case "disconnect":
      if (ctx.flags.yes !== true) return usage(deps, "sso disconnect --yes");
      await client.sso.disconnect();
      emit("SSO connection disconnected", { disconnected: true });
      return EXIT.ok;
    default:
      return usage(deps, "sso <status|identity|validate|connection|connect|disconnect>");
  }
}
