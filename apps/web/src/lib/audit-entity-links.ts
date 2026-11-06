import type { AuditLogEntry } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
const directories: Record<string, string> = {
  exportSchedules: "/insights/exports",
  assistantList: "/", helpDeskList: "/help-desks", aiSettings: "/settings/ai", crawlerSettings: "/settings/crawling",
  members: "/settings/members", organization: "/settings/general", apiKeys: "/settings/api-keys", alerts: "/alerts",
  improvementList: "/improvements", improvementTasks: "/improvements", inbox: "/inbox", quickTexts: "/settings/quick-texts",
  webhookSettings: "/settings/webhooks", mcpSettings: "/settings/mcp-servers", businessHoursSettings: "/settings/business-hours",
  knowledgeHub: "/library/websites", teammateList: "/teammates", channelList: "/teammates", projectList: "/projects",
  taskList: "/tasks", taskLabels: "/tasks", myNotifications: "/notifications", evaluations: "/eval", myMemory: "/settings/memory",
};
/** Historical ids remain readable; only surviving entities receive detail links. */
export async function auditEntityLinks(db: Db, entries: AuditLogEntry[]): Promise<Record<string, string>> {
  const entities = new Map(entries.flatMap(entry => entry.entities.map(entity => [`${entity.kind}:${entity.id ?? entity.assistantId ?? ""}`, entity] as const)));
  const links = await Promise.all([...entities].map(async ([key, entity]) => {
    const id = entity.id ?? entity.assistantId;
    let path = directories[entity.kind];
    if (id) {
      const segment = encodeURIComponent(id);
      if (["assistant", "assistantEditor", "flows"].includes(entity.kind) && await db.getAssistant(id)) path = `/assistants/${segment}`;
      if (entity.kind === "project" && await db.table("projects").get(id)) path = `/projects/${segment}`;
      if (entity.kind === "task" && await db.table("tasks").get(id)) path = `/tasks/${segment}`;
      if (entity.kind === "teammate" && await db.table("teammates").get(id)) path = `/teammates/${segment}`;
      if (entity.kind === "channel" && await db.table("teammateChannels").get(id)) path = `/teammates/channels/${segment}`;
      if (entity.kind === "helpDesk" && await db.getHelpDesk(id)) path = `/help-desks/${segment}`;
      if (entity.kind === "improvement" && await db.getImprovement(id)) path = `/improvements/${segment}`;
      if (entity.kind === "applicationConnection" && await db.getApplicationConnection(id)) path = "/settings/applications";
    }
    return [key, path] as const;
  }));
  return Object.fromEntries(links.flatMap(([key, path]) => path ? [[key, path]] : []));
}
