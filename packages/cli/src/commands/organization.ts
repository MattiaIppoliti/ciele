import { readFileSync } from "node:fs";
import type { OrganizationPatch, Role } from "@agent-hub/core";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

const roles = new Set<Role>(["owner", "admin", "editor", "viewer"]);
function role(value: string | undefined): Role | undefined {
  return value && roles.has(value as Role) ? (value as Role) : undefined;
}

export async function organization(verb: string | undefined, ctx: CommandContext) {
  const { client, flags, emit, deps } = ctx;
  switch (verb) {
    case "get": {
      const org = await client.organization.get();
      emit(JSON.stringify(org, null, 2), org);
      return EXIT.ok;
    }
    case "update": {
      const file = str(flags.file);
      if (!file) return usage(deps, "organization update --file <patch.json>");
      const patch = JSON.parse(readFileSync(file, "utf8")) as OrganizationPatch;
      const org = await client.organization.update(patch);
      emit(`Updated ${org.id}`, org);
      return EXIT.ok;
    }
    default:
      return usage(deps, "organization <get|update>");
  }
}

export async function members(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.members.list();
      emit(table(result.data, [
        { key: "userId", header: "User" },
        { key: "email", header: "Email" },
        { key: "role", header: "Role" },
      ]), result);
      return EXIT.ok;
    }
    case "set-role": {
      const nextRole = role(str(flags.role));
      if (!rest[0] || !nextRole) {
        return usage(deps, "members set-role <userId> --role <owner|admin|editor|viewer>");
      }
      const member = await client.members.setRole(rest[0], nextRole);
      emit(`Updated ${member.userId} to ${member.role}`, member);
      return EXIT.ok;
    }
    case "remove":
      if (!rest[0] || flags.yes !== true) return usage(deps, "members remove <userId> --yes");
      await client.members.remove(rest[0]);
      emit(`Removed ${rest[0]}`, { removed: rest[0] });
      return EXIT.ok;
    default:
      return usage(deps, "members <list|set-role|remove>");
  }
}

export async function invites(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.invites.list();
      emit(table(result.data, [
        { key: "id", header: "ID" },
        { key: "email", header: "Email" },
        { key: "role", header: "Role" },
        { key: "expiresAt", header: "Expires" },
      ]), result);
      return EXIT.ok;
    }
    case "create": {
      const inviteRole = role(str(flags.role));
      if (!inviteRole) {
        return usage(deps, "invites create --role <owner|admin|editor|viewer> [--email <email>]");
      }
      const invite = await client.invites.create({
        role: inviteRole,
        email: str(flags.email),
      });
      emit(`Created invite ${invite.id}`, invite);
      return EXIT.ok;
    }
    case "revoke":
      if (!rest[0] || flags.yes !== true) return usage(deps, "invites revoke <id> --yes");
      await client.invites.revoke(rest[0]);
      emit(`Revoked ${rest[0]}`, { revoked: rest[0] });
      return EXIT.ok;
    default:
      return usage(deps, "invites <list|create|revoke>");
  }
}

export async function apiKeys(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.apiKeys.list();
      emit(table(result.data, [
        { key: "id", header: "ID" },
        { key: "name", header: "Name" },
        { key: "role", header: "Role" },
        { key: "secretHint", header: "Secret" },
        { key: "lastUsedAt", header: "Last used" },
      ]), result);
      return EXIT.ok;
    }
    case "create": {
      const name = str(flags.name);
      const keyRole = role(str(flags.role));
      if (!name || !keyRole) {
        return usage(deps, "api-keys create --name <name> --role <owner|admin|editor|viewer>");
      }
      const result = await client.apiKeys.create({ name, role: keyRole });
      emit(
        `Created ${result.apiKey.id}. Save this secret now; it is shown once:\n${result.secret}`,
        result
      );
      return EXIT.ok;
    }
    case "revoke":
      if (!rest[0] || flags.yes !== true) return usage(deps, "api-keys revoke <id> --yes");
      await client.apiKeys.revoke(rest[0]);
      emit(`Revoked ${rest[0]}`, { revoked: rest[0] });
      return EXIT.ok;
    default:
      return usage(deps, "api-keys <list|create|revoke>");
  }
}
