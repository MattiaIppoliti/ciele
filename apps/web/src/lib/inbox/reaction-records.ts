import type { Db } from "@agent-hub/db";

/** Call only after authorizing the Inbox transcript; reads use the server Db. */
export async function readReactionRecords(db: Db, organizationId: string, messageIds: string[]) {
  return (await Promise.all(messageIds.map(async (messageId) => {
    try { return await db.listMessageReactions(organizationId, messageId); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && ["42P01", "PGRST205"].includes(String(error.code))) return [];
      throw error;
    }
  }))).flat();
}
