import type { OrganizationPatch, Role } from "@agent-hub/core";
import { ROLES } from "@agent-hub/core";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { jsonFile, str, strList, usage, type CommandContext, emitJson, confirmed } from "./shared.ts";

/** `--role-id <id>` (any Role, custom ones included) or `--role <name>` (a built-in). */
function roleChoice(flags: CommandContext["flags"]): { roleId: string } | { role: Role } | undefined {
  const roleId = str(flags["role-id"]);
  if (roleId) return { roleId };
  const named = role(str(flags.role));
  return named ? { role: named } : undefined;
}

const LADDER_ROLES = new Set<Role>(ROLES);
function role(value: string | undefined): Role | undefined {
  return value && LADDER_ROLES.has(value as Role) ? (value as Role) : undefined;
}

export async function organization(verb: string | undefined, ctx: CommandContext) {
  const { client, emit, deps } = ctx;
  switch (verb) {
    case "get": {
      const org = await client.organization.get();
      emitJson(emit, org);
      return EXIT.ok;
    }
    case "update": {
      const patch = jsonFile<OrganizationPatch>(ctx, "organization update --file <patch.json>");
      if (patch === undefined) return EXIT.usage;
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
      emit(table(result.data.map((member) => ({ ...member, roleName: member.roleName ?? member.role })), [
        { key: "userId", header: "User" },
        { key: "email", header: "Email" },
        { key: "roleName", header: "Role" },
      ]), result);
      return EXIT.ok;
    }
    case "set-role": {
      const nextRole = roleChoice(flags);
      if (!rest[0] || !nextRole) {
        return usage(deps, "members set-role <userId> --role <owner|admin|editor|viewer> | --role-id <roleId>");
      }
      const member = await client.members.setRole(rest[0], nextRole);
      emit(`Updated ${member.userId} to ${member.roleName ?? member.role}`, member);
      return EXIT.ok;
    }
    case "remove":
      if (!rest[0] || !confirmed(flags)) return usage(deps, "members remove <userId> --yes");
      await client.members.remove(rest[0]);
      emit(`Removed ${rest[0]}`, { removed: rest[0] });
      return EXIT.ok;
    case "assistants": {
      if (!rest[0]) return usage(deps, "members assistants <userId>");
      const view = await client.members.assistants(rest[0]);
      emit(
        view.scope === "selected"
          ? `Only selected assistants:\n${view.access.map((row) => `  ${row.assistantId}  ${row.role}`).join("\n") || "  (none)"}`
          : `All assistants${view.access.length ? `, with overrides:\n${view.access.map((row) => `  ${row.assistantId}  ${row.role}`).join("\n")}` : ""}`,
        view
      );
      return EXIT.ok;
    }
    case "set-assistants": {
      const scope = str(flags.scope);
      const hint = "members set-assistants <userId> --scope all|selected [--assistants <id>:<role|roleId>,<id>:<role|roleId>]";
      if (!rest[0] || (scope !== "all" && scope !== "selected")) return usage(deps, hint);
      const access: Array<{ assistantId: string; role: "denied" | "viewer" | "editor" | "admin"; roleId?: string }> = [];
      for (const pair of (str(flags.assistants) ?? "").split(",").map((item) => item.trim()).filter(Boolean)) {
        const [assistantId, accessRole] = pair.split(":");
        if (!assistantId || !accessRole || accessRole === "owner") return usage(deps, hint);
        // A ladder name is a built-in; anything else is a Role id.
        access.push(["denied", "viewer", "editor", "admin"].includes(accessRole)
          ? { assistantId, role: accessRole as "denied" | "viewer" | "editor" | "admin" }
          : { assistantId, role: "viewer", roleId: accessRole });
      }
      const view = await client.members.setAssistants(rest[0], { scope, access });
      emit(`Updated ${view.userId}: ${view.scope === "selected" ? `${view.access.length} selected assistant(s)` : "all assistants"}`, view);
      return EXIT.ok;
    }
    default:
      return usage(deps, "members <list|set-role|remove|assistants|set-assistants>");
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
      const inviteRole = roleChoice(flags);
      if (!inviteRole) {
        return usage(deps, "invites create --role <owner|admin|editor|viewer> | --role-id <roleId> [--email <email>]");
      }
      const invite = await client.invites.create({
        ...inviteRole,
        email: str(flags.email),
      });
      emit(`Created invite ${invite.id}`, invite);
      return EXIT.ok;
    }
    case "revoke":
      if (!rest[0] || !confirmed(flags)) return usage(deps, "invites revoke <id> --yes");
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
      const keyRole = roleChoice(flags);
      if (!name || !keyRole) {
        return usage(deps, "api-keys create --name <name> --role <owner|admin|editor|viewer> | --role-id <roleId>");
      }
      const result = await client.apiKeys.create({ name, ...keyRole });
      emit(
        `Created ${result.apiKey.id}. Save this secret now; it is shown once:\n${result.secret}`,
        result
      );
      return EXIT.ok;
    }
    case "revoke":
      if (!rest[0] || !confirmed(flags)) return usage(deps, "api-keys revoke <id> --yes");
      await client.apiKeys.revoke(rest[0]);
      emit(`Revoked ${rest[0]}`, { revoked: rest[0] });
      return EXIT.ok;
    default:
      return usage(deps, "api-keys <list|create|revoke>");
  }
}

/** `ciele roles …` (#1164): the Organization's Roles and their Capabilities. */
export async function roles(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, flags, emit, deps } = ctx;
  const input = () => ({
    ...(str(flags.name) !== undefined ? { name: str(flags.name)! } : {}),
    ...(str(flags.description) !== undefined ? { description: str(flags.description)! } : {}),
    ...(flags.capabilities !== undefined ? { capabilities: strList(flags.capabilities) } : {}),
    ...(str(flags.available) !== undefined
      ? {
          organizationLevel: (str(flags.available) ?? "").split(",").includes("organization"),
          assistantLevel: (str(flags.available) ?? "").split(",").includes("assistant"),
        }
      : {}),
  });
  switch (verb) {
    case "list": {
      const result = await client.roles.list();
      emit(table(result.data.map((item) => ({
        ...item,
        kind: item.locked ? "locked" : item.builtIn ? (item.edited ? "built-in, edited" : "built-in") : "custom",
        count: item.capabilities.length,
        defaults: [item.memberDefault ? "invitations" : "", item.assistantDefault ? "assistants" : ""].filter(Boolean).join(", "),
      })), [
        { key: "id", header: "ID" },
        { key: "name", header: "Role" },
        { key: "kind", header: "Kind" },
        { key: "count", header: "Capabilities" },
        { key: "memberCount", header: "Members" },
        { key: "defaults", header: "Default for" },
      ]), result);
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "roles get <roleId>");
      const found = await client.roles.get(rest[0]);
      emit(`${found.name}\n${found.capabilities.map((id) => `  ${id}`).join("\n") || "  (no capabilities)"}`, found);
      return EXIT.ok;
    }
    case "create": {
      const hint = 'roles create --name <name> --capabilities <a:b,c:d> [--description <text>] [--available organization,assistant]';
      const fields = input();
      if (!fields.name) return usage(deps, hint);
      const created = await client.roles.create({
        name: fields.name,
        description: fields.description ?? "",
        capabilities: fields.capabilities ?? [],
        organizationLevel: fields.organizationLevel ?? true,
        assistantLevel: fields.assistantLevel ?? false,
      });
      emit(`Created ${created.id} (${created.name}, ${created.capabilities.length} capabilities)`, created);
      return EXIT.ok;
    }
    case "update": {
      const fields = input();
      if (!rest[0] || !Object.keys(fields).length) {
        return usage(deps, "roles update <roleId> [--name <name>] [--description <text>] [--capabilities <a:b,…>] [--available organization,assistant]");
      }
      const updated = await client.roles.update(rest[0], fields);
      emit(`Updated ${updated.name} (${updated.capabilities.length} capabilities)`, updated);
      return EXIT.ok;
    }
    case "reset": {
      if (!rest[0]) return usage(deps, "roles reset <roleId>");
      const reset = await client.roles.reset(rest[0]);
      emit(`Reset ${reset.name} to its default capabilities`, reset);
      return EXIT.ok;
    }
    case "delete":
      if (!rest[0] || !confirmed(flags)) return usage(deps, "roles delete <roleId> --yes");
      await client.roles.delete(rest[0]);
      emit(`Deleted ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    case "set-defaults": {
      const memberRoleId = str(flags.member);
      const assistantRoleId = str(flags.assistant);
      if (!memberRoleId && !assistantRoleId) return usage(deps, "roles set-defaults [--member <roleId>] [--assistant <roleId>]");
      const result = await client.roles.setDefaults({
        ...(memberRoleId ? { memberRoleId } : {}),
        ...(assistantRoleId ? { assistantRoleId } : {}),
      });
      emit("Default roles updated", result);
      return EXIT.ok;
    }
    default:
      return usage(deps, "roles <list|get|create|update|reset|delete|set-defaults>");
  }
}
