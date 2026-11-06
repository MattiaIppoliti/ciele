import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { bool, csv, str, usage, type CommandContext } from "./shared.ts";

interface AuditRow {
  createdAt: string;
  operation: string;
  outcome: string;
  surface: string;
  memberId: string | null;
  memberName: string | null;
  memberEmail: string | null;
  apiKeyId: string | null;
  teammateId: string | null;
  targetLabel?: string | null;
  targetDetail?: string | null;
}

/**
 * `ciele audit-log list`: the Organization audit log, newest first. Read-only;
 * operations write every entry as they run, so no verb writes one.
 */
export async function auditLog(verb: string | undefined, ctx: CommandContext): Promise<number> {
  const { client, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const action = str(flags.action);
      const limit = str(flags.limit);
      const { data } = (await client.auditLog.list({
        actions: action ? csv(action) : undefined,
        actor: str(flags.actor),
        domain: str(flags.domain),
        from: str(flags.from),
        to: str(flags.to),
        order: bool(flags["oldest-first"]) ? "oldest" : undefined,
        before: str(flags.before),
        beforeId: str(flags["before-id"]),
        limit: limit ? Number(limit) : undefined,
      })) as { data: AuditRow[] };
      emit(
        table(
          data.map((entry) => ({
            when: entry.createdAt,
            action: entry.outcome === "ok" ? entry.operation : `${entry.operation} (refused: ${entry.outcome})`,
            // No member means the system acted; a key or a Teammate acts for one.
            actor: entry.memberId
              ? [entry.apiKeyId ? `API key ${entry.apiKeyId}` : entry.teammateId ? `Teammate ${entry.teammateId}` : null, entry.memberEmail ?? entry.memberName]
                  .filter(Boolean)
                  .join(" for ")
              : "System",
            target: entry.targetLabel
              ? entry.targetDetail
                ? `${entry.targetLabel} (${entry.targetDetail})`
                : entry.targetLabel
              : "",
            surface: entry.surface,
          })),
          [
            { key: "when", header: "When (UTC)" },
            { key: "action", header: "Action" },
            { key: "actor", header: "Actor" },
            { key: "target", header: "Target" },
            { key: "surface", header: "Surface" },
          ]
        ),
        data
      );
      return EXIT.ok;
    }
    default:
      return usage(
        deps,
        "audit-log list [--action <op,op>] [--actor <userId|system>] [--domain <d>] [--from <date>] [--to <date>] [--oldest-first] [--before <iso> --before-id <id>] [--limit <n>]"
      );
  }
}
