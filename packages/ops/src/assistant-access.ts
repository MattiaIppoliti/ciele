import { z } from "zod";
import { defineOperation, OperationError } from "./operation";
import { requireAssistant } from "./assistants";
import { describeAuditChange } from "./audit";
import { assertMayHandOn } from "./roles";
import type { Member, MemberAssistantScope, OrgRole } from "@agent-hub/core";
import type { OperationContext } from "./operation";

/**
 * The Role a row names on an Assistant (ADR-0028): one offered on
 * Assistants, and one the caller could hand on. No `roleId` means the
 * built-in of the row's ladder name, the shape every client sent before.
 */
async function resolveAssistantRole(
  ctx: OperationContext,
  row: { role: string | null; roleId?: string | null }
): Promise<OrgRole | null> {
  if (row.role === "denied" || (row.role === null && !row.roleId)) return null;
  const roles = await ctx.db.listOrgRoles(ctx.organizationId);
  const role = row.roleId ? roles.find((item) => item.id === row.roleId) : roles.find((item) => item.key === row.role);
  if (!role) throw new OperationError("not_found", "Role not found");
  if (!role.assistantLevel) throw new OperationError("invalid_input", `${role.name} is not available on Assistants`);
  assertMayHandOn(ctx, role);
  return role;
}

/**
 * How a row reads in the log. No row means the org Role for a Member on all
 * Assistants, and no access at all for one limited to selected Assistants.
 */
const accessLabel = (role: string | null, scope: MemberAssistantScope = "all") =>
  role === null ? (scope === "selected" ? "No access" : "Organization role") : role.charAt(0).toUpperCase() + role.slice(1);

async function requireMember(ctx: { organizationId: string; db: { listMembers(org: string): Promise<Member[]> } }, userId: string): Promise<Member> {
  const member = (await ctx.db.listMembers(ctx.organizationId)).find(row => row.userId === userId);
  if (!member) throw new OperationError("not_found", "Member not found");
  return member;
}
export const assistantAccessInput = z.object({
  assistantId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["denied", "viewer", "editor", "admin"]).nullable(),
  /** A Role offered on Assistants, custom ones included; wins over `role`. */
  roleId: z.string().min(1).nullish(),
});
export const listAssistantAccessOp = defineOperation({
  name: "assistants.access.list", capability: "assistants:access", effect: "read",
  input: z.object({ assistantId: z.string().min(1) }), entities: () => [],
  run: async (ctx, { assistantId }) => {
    await requireAssistant(ctx, assistantId);
    const [members, overrides] = await Promise.all([ctx.db.listMembers(ctx.organizationId), ctx.db.listAssistantAccess(assistantId)]);
    return members.map(member => ({ ...member, override: overrides.find(row => row.userId === member.userId) ?? null }));
  },
});
export const setAssistantAccessOp = defineOperation({
  name: "assistants.access.set", capability: "assistants:access", effect: "consequential", input: assistantAccessInput,
  entities: ({ assistantId }) => [{ kind: "assistant" as const, id: assistantId }],
  run: async (ctx, input) => {
    if (ctx.teammate) throw new OperationError("invalid_input", "Teammates cannot change Assistant access");
    const assistant = await requireAssistant(ctx, input.assistantId);
    const member = await requireMember(ctx, input.userId);
    const scope = member.assistantScope ?? "all";
    // For a Member limited to selected Assistants, no row already hides the
    // Assistant; a denied row there would only be a second way to say it.
    if (scope === "selected" && input.role === "denied") {
      throw new OperationError("invalid_input", "This member only reaches selected assistants; remove the row to take this one away");
    }
    const role = await resolveAssistantRole(ctx, input);
    const previous = (await ctx.db.listAssistantAccess(input.assistantId)).find(row => row.userId === input.userId);
    const previousLabel = previous ? previous.roleName ?? accessLabel(previous.role, scope) : accessLabel(null, scope);
    const nextLabel = role ? role.name : accessLabel(input.roleId ? null : input.role, scope);
    describeAuditChange({
      target: { label: member.email, detail: assistant.title },
      changes: { [`Access to ${assistant.title}`]: { before: previousLabel, after: nextLabel } },
    });
    if (input.role === null && !input.roleId) await ctx.db.clearAssistantAccess(input.assistantId, input.userId);
    else if (role) await ctx.db.setAssistantAccess(input.assistantId, input.userId, "viewer", role.id);
    else await ctx.db.setAssistantAccess(input.assistantId, input.userId, "denied");
    return { assistantId: input.assistantId };
  },
});

const scopedAccessRow = z.object({
  assistantId: z.string().min(1),
  role: z.enum(["denied", "viewer", "editor", "admin"]),
  roleId: z.string().min(1).nullish(),
});

/** One Member's scope and override rows, with each Assistant's title. */
export const getMemberAssistantAccessOp = defineOperation({
  name: "members.assistantAccess.get", capability: "members:manage", effect: "read",
  input: z.object({ userId: z.string().min(1) }), entities: () => [],
  run: async (ctx, { userId }) => {
    const member = await requireMember(ctx, userId);
    return { userId, scope: member.assistantScope ?? "all", access: await ctx.db.listMemberAssistantAccess(ctx.organizationId, userId) };
  },
});

/**
 * Limit a Member to selected Assistants, or give them every Assistant again,
 * and set their override rows, in one write (Settings > Members). In
 * `selected` mode the rows are the whole list a Member can reach, so a
 * `denied` row there means nothing and is refused; in `all` mode the rows are
 * overrides of the org Role, as on an Assistant's Manage access.
 */
export const setMemberAssistantScopeOp = defineOperation({
  name: "members.assistantScope.set", capability: "members:manage", effect: "consequential",
  input: z.object({ userId: z.string().min(1), scope: z.enum(["all", "selected"]), access: z.array(scopedAccessRow).max(500) }),
  entities: () => [{ kind: "members" as const }],
  run: async (ctx, input) => {
    if (ctx.teammate) throw new OperationError("invalid_input", "Teammates cannot change Assistant access");
    const member = await requireMember(ctx, input.userId);
    if (member.role === "owner" && input.scope === "selected") {
      throw new OperationError("invalid_input", "An owner always has access to every assistant");
    }
    if (input.scope === "selected" && input.access.some(row => row.role === "denied")) {
      throw new OperationError("invalid_input", "A member limited to selected assistants reaches only those listed; leave out the ones to hide");
    }
    if (new Set(input.access.map(row => row.assistantId)).size !== input.access.length) {
      throw new OperationError("invalid_input", "Each assistant may appear once");
    }
    const assistants = new Map((await ctx.db.listAssistants(ctx.organizationId)).map(row => [row.id, row.title]));
    const unknown = input.access.find(row => !assistants.has(row.assistantId));
    if (unknown) throw new OperationError("not_found", "Assistant not found");
    const resolved = await Promise.all(input.access.map(async (row) => ({ row, role: await resolveAssistantRole(ctx, row) })));
    const access = resolved.map(({ row, role }) => (role ? { assistantId: row.assistantId, role: row.role, roleId: role.id } : row));
    const before = await ctx.db.listMemberAssistantAccess(ctx.organizationId, input.userId);
    await ctx.db.setMemberAssistantScope(ctx.organizationId, input.userId, input.scope, access);
    const names = new Map(resolved.map(({ row, role }) => [row.assistantId, role?.name]));
    const readable = (scope: string, rows: { assistantId: string; role: string; roleName?: string }[]) => ({
      scope: scope === "selected" ? "Selected assistants" : "All assistants",
      assistants: Object.fromEntries(rows.map(row => [assistants.get(row.assistantId) ?? row.assistantId, row.roleName ?? accessLabel(row.role)])),
    });
    describeAuditChange({
      target: {
        label: member.email,
        detail: input.scope === "selected" ? `${input.access.length} selected assistant${input.access.length === 1 ? "" : "s"}` : "All assistants",
      },
      changes: {
        "Assistant access": {
          before: readable(member.assistantScope ?? "all", before),
          after: readable(input.scope, access.map((row) => ({ ...row, roleName: names.get(row.assistantId) }))),
        },
      },
    });
    return { userId: input.userId, scope: input.scope, access };
  },
});
