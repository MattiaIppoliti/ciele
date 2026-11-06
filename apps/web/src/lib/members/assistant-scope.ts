import type { AssistantAccessRole, MemberAssistantAccess, MemberAssistantScope, Role } from "@agent-hub/core";
import { roleLabel } from "@agent-hub/core";

/**
 * The Members page's Assistant access, as pure functions: the summary a row
 * shows and the draft the "Assistants" dialog edits. The rule they present is
 * the database's (20261104132000): `all` is the org Role on every Assistant,
 * with any override rows replacing it on theirs; `selected` reaches only the
 * Assistants with a row, each at that row's Role.
 */

/**
 * One Assistant's row in the draft: `denied`, or the id of the Role given
 * there (ADR-0028). A row read before Roles had ids is `builtin:<key>`.
 */
export type AccessChoice = string;

/** A Role the dialog can give on an Assistant. */
export interface AssistantRoleOption {
  id: string;
  name: string;
  key: string | null;
  assistantDefault: boolean;
}

export interface ScopeDraft {
  scope: MemberAssistantScope;
  /** assistantId → its row; an Assistant with no entry has no row. */
  rows: Readonly<Record<string, AccessChoice>>;
}

export function choiceOf(row: Pick<MemberAssistantAccess, "role" | "roleId">): AccessChoice {
  if (row.role === "denied") return "denied";
  return row.roleId ?? `builtin:${row.role}`;
}

export function draftFrom(scope: MemberAssistantScope, access: readonly MemberAssistantAccess[]): ScopeDraft {
  return { scope, rows: Object.fromEntries(access.map((row) => [row.assistantId, choiceOf(row)])) };
}

/** The Role a newly selected Assistant starts at: the Organization's Assistant default. */
export function defaultAssistantChoice(roles: readonly AssistantRoleOption[]): AccessChoice {
  return (roles.find((role) => role.assistantDefault) ?? roles.find((role) => role.key === "viewer") ?? roles[0])?.id ?? "builtin:viewer";
}

/** The name a row reads as. */
export function choiceLabel(choice: AccessChoice | null, roles: readonly AssistantRoleOption[]): string {
  if (choice === null) return "Organization role";
  if (choice === "denied") return "Denied";
  const role = roles.find((item) => item.id === choice);
  if (role) return role.name;
  const key = choice.startsWith("builtin:") ? choice.slice("builtin:".length) : choice;
  return key === "viewer" || key === "editor" || key === "admin" ? roleLabel(key) : "Role";
}

/**
 * Switching to `selected` keeps every granted row and drops the denials, which
 * mean nothing there; switching back to `all` keeps the rows as overrides.
 */
export function withScope(draft: ScopeDraft, scope: MemberAssistantScope): ScopeDraft {
  if (scope === draft.scope) return draft;
  if (scope === "all") return { scope, rows: draft.rows };
  return {
    scope,
    rows: Object.fromEntries(Object.entries(draft.rows).filter(([, choice]) => choice !== "denied")),
  };
}

/** Set one Assistant's row, or remove it with null. */
export function withRow(draft: ScopeDraft, assistantId: string, choice: AccessChoice | null): ScopeDraft {
  const rows = { ...draft.rows };
  if (choice === null) delete rows[assistantId];
  else rows[assistantId] = choice;
  return { ...draft, rows };
}

/** Tick or clear every listed Assistant in `selected` mode. */
export function withAllSelected(draft: ScopeDraft, assistantIds: readonly string[], checked: boolean, choice: AccessChoice): ScopeDraft {
  const rows = { ...draft.rows };
  for (const id of assistantIds) {
    if (checked) rows[id] ??= choice;
    else delete rows[id];
  }
  return { ...draft, rows };
}

/** One row as the operation takes it. */
export function accessRow(assistantId: string, choice: AccessChoice): MemberAssistantAccess {
  if (choice === "denied") return { assistantId, role: "denied" };
  if (choice.startsWith("builtin:")) {
    const key = choice.slice("builtin:".length) as AssistantAccessRole;
    return { assistantId, role: key };
  }
  return { assistantId, role: "viewer", roleId: choice };
}

/** What the operation takes, in the order the dialog lists the Assistants. */
export function draftAccess(draft: ScopeDraft, assistantIds: readonly string[]): MemberAssistantAccess[] {
  return assistantIds.flatMap((assistantId) => {
    const choice = draft.rows[assistantId];
    if (!choice || (draft.scope === "selected" && choice === "denied")) return [];
    return [accessRow(assistantId, choice)];
  });
}

export function sameDraft(a: ScopeDraft, b: ScopeDraft): boolean {
  if (a.scope !== b.scope) return false;
  const keys = new Set([...Object.keys(a.rows), ...Object.keys(b.rows)]);
  return [...keys].every((key) => a.rows[key] === b.rows[key]);
}

/** What the Members table says in the Assistants column. */
export function scopeSummary(input: { role: Role; scope: MemberAssistantScope; rows: number }): string {
  if (input.role === "owner") return "All assistants · Owner";
  if (input.scope === "selected") return input.rows === 1 ? "1 assistant" : `${input.rows} assistants`;
  if (input.rows === 0) return `All assistants · ${roleLabel(input.role)}`;
  return `All assistants · ${input.rows} override${input.rows === 1 ? "" : "s"}`;
}
