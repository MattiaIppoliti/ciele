/**
 * How the audit log names an operation. Every write operation is recorded
 * (20261023080000_configuration_audit), so the label set is open: the
 * governance operations an administrator scans for have their own label, and
 * any other operation reads from its name ("flows.update" is "Updated flow").
 */

/** How an action is drawn: something added, changed, or taken away. */
export type AuditActionTone = "added" | "changed" | "removed";

export interface AuditActionInfo {
  label: string;
  tone: AuditActionTone;
}

/** The operations an administrator filters the log by most, with their labels. */
export const AUDIT_ACTIONS = {
  "members.updateRole": { label: "Changed member role", tone: "changed" },
  "members.remove": { label: "Removed member", tone: "removed" },
  "members.leave": { label: "Left organization", tone: "removed" },
  "members.assistantScope.set": { label: "Changed assistant access", tone: "changed" },
  "invites.create": { label: "Sent invitation", tone: "added" },
  "invites.revoke": { label: "Withdrew invitation", tone: "removed" },
  "apiKeys.create": { label: "Created API key", tone: "added" },
  "apiKeys.revoke": { label: "Revoked API key", tone: "removed" },
  "apiKeys.delete": { label: "Deleted API key", tone: "removed" },
  "assistants.access.set": { label: "Set assistant access", tone: "changed" },
  "organization.update": { label: "Updated organization", tone: "changed" },
  "organization.budget.set": { label: "Set budget", tone: "changed" },
  "audit.export": { label: "Exported audit log", tone: "changed" },
} as const satisfies Record<string, AuditActionInfo>;

const VERBS: Record<string, { past: string; tone: AuditActionTone }> = {
  create: { past: "Created", tone: "added" },
  add: { past: "Added", tone: "added" },
  import: { past: "Imported", tone: "added" },
  duplicate: { past: "Duplicated", tone: "added" },
  publish: { past: "Published", tone: "added" },
  grant: { past: "Granted", tone: "added" },
  update: { past: "Updated", tone: "changed" },
  set: { past: "Set", tone: "changed" },
  reorder: { past: "Reordered", tone: "changed" },
  resolve: { past: "Resolved", tone: "changed" },
  restore: { past: "Restored", tone: "changed" },
  revert: { past: "Reverted", tone: "changed" },
  pin: { past: "Pinned", tone: "changed" },
  sync: { past: "Synced", tone: "changed" },
  configure: { past: "Configured", tone: "changed" },
  setMany: { past: "Set", tone: "changed" },
  unlink: { past: "Unlinked", tone: "removed" },
  delete: { past: "Deleted", tone: "removed" },
  remove: { past: "Removed", tone: "removed" },
  revoke: { past: "Revoked", tone: "removed" },
  archive: { past: "Archived", tone: "removed" },
  unpublish: { past: "Unpublished", tone: "removed" },
  clear: { past: "Cleared", tone: "removed" },
};

const ACRONYMS: Record<string, string> = { api: "API", mcp: "MCP", faq: "FAQ", sso: "SSO", faqs: "FAQs" };

/** `helpDesks channels` → `help desk channel`: words, acronyms, each singular. */
function nounPhrase(path: readonly string[]): string {
  const all = path
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return all
    .map((word) => {
      // "desks" → "desk", but never "business", "status" or "analysis".
      const singular = word.length > 3 && /[^sui]s$/.test(word) ? word.slice(0, -1) : word;
      return ACRONYMS[word] ?? ACRONYMS[singular] ?? singular;
    })
    .join(" ");
}

/** `flows.update` reads "Updated flow"; a name it cannot read is shown as it is. */
export function auditActionInfo(operation: string): AuditActionInfo {
  const curated = (AUDIT_ACTIONS as Record<string, AuditActionInfo>)[operation];
  if (curated) return curated;
  const parts = operation.split(".");
  const verb = parts.at(-1) ?? "";
  const known = VERBS[verb];
  if (!known || parts.length < 2) return { label: operation, tone: "changed" };
  return { label: `${known.past} ${nounPhrase(parts.slice(0, -1))}`, tone: known.tone };
}

/** The value the actor filter uses for entries no person made. */
export const AUDIT_SYSTEM_ACTOR = "system";
