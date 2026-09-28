import { EXIT } from "../index.ts";
import { jsonFile, usage, type CommandContext } from "./shared.ts";

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
      const input = jsonFile<Parameters<typeof client.sso.connect>[0]>(
        ctx,
        "sso connect --file <connection.json>"
      );
      if (input === undefined) return EXIT.usage;
      const result = await client.sso.connect(input);
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
