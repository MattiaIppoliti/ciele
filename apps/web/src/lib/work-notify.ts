import type { EmailMessage } from "@agent-hub/agent";
import { memberDisplayName, taskKey } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { WorkActivityEntry, WorkNotificationRow } from "@ciele/ops";
import { appOrigin } from "@/lib/origins";

/**
 * The host half of the work domain's `workLog` port (#1051, #1048).
 *
 * Both writes run on the system Db because neither table has a member write
 * policy; the operation already decided every row (who did it, who hears
 * about it, and that each recipient can see the Task). What this adds is the
 * email a recipient's preferences allow: assigned and mentioned, each with its
 * own switch, default on. Plain text, one per row, best effort: a failed send
 * never fails the write that raised it.
 */

const EMAILED_KINDS = new Set<WorkNotificationRow["kind"]>(["assigned", "mentioned"]);

export function taskAssignedEmail(input: {
  to: string;
  key: string;
  title: string;
  actor: string;
  url: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: `${input.key} was assigned to you: ${input.title}`,
    body: `${input.actor} assigned ${input.key} ("${input.title}") to you.\n\nOpen it: ${input.url}`,
  };
}

export function taskMentionedEmail(input: {
  to: string;
  key: string;
  title: string;
  actor: string;
  url: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: `${input.actor} mentioned you on ${input.key}: ${input.title}`,
    body: `${input.actor} mentioned you on ${input.key} ("${input.title}").\n\nOpen it: ${input.url}`,
  };
}

/**
 * Who the email says did it. A Teammate's write notifies exactly as a
 * Member's would (#1048), so the Teammate is named, as the Notifications page
 * names it, rather than the Member who invoked it.
 */
async function actorName(
  system: Db,
  row: WorkNotificationRow,
  members: Awaited<ReturnType<Db["listMembers"]>>
): Promise<string> {
  if (row.actorTeammateId) {
    const teammate = await system.table("teammates").get(row.actorTeammateId);
    if (teammate?.organizationId === row.organizationId) return teammate.name;
  }
  const member = row.actorMemberId ? members.find((m) => m.userId === row.actorMemberId) : undefined;
  return member ? memberDisplayName(member) : "A colleague";
}

export async function recordWorkActivity(system: Db, rows: WorkActivityEntry[]): Promise<void> {
  for (const row of rows) await system.table("workActivity").insert(row);
}

export async function raiseWorkNotifications(
  system: Db,
  rows: WorkNotificationRow[],
  send: (message: EmailMessage) => Promise<unknown>
): Promise<void> {
  for (const row of rows) await system.table("memberNotifications").insert(row);
  const emailed = rows.filter((row) => EMAILED_KINDS.has(row.kind));
  if (!emailed.length) return;
  try {
    const organizationId = emailed[0]!.organizationId;
    const members = await system.listMembers(organizationId);
    const prefs = await system.table("notificationPreferences").list({ organizationId });
    const origin = appOrigin("https://ciele.app");
    for (const row of emailed) {
      const member = members.find((m) => m.userId === row.recipientId);
      if (!member?.email) continue;
      const pref = prefs.find((p) => p.userId === row.recipientId);
      if (row.kind === "assigned" && pref && !pref.emailAssigned) continue;
      if (row.kind === "mentioned" && pref && !pref.emailMentioned) continue;
      const [task, project] = await Promise.all([
        system.table("tasks").get(row.taskId),
        system.table("projects").get(row.projectId),
      ]);
      if (!task || !project) continue;
      const actor = await actorName(system, row, members);
      const input = {
        to: member.email,
        key: taskKey(project.key, task.seq),
        title: task.title,
        actor,
        url: `${origin}/tasks/${task.id}`,
      };
      await send(row.kind === "assigned" ? taskAssignedEmail(input) : taskMentionedEmail(input));
    }
  } catch (error) {
    console.warn("[work-notify] email skipped", error);
  }
}
