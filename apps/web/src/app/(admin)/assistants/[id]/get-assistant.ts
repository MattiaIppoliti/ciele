import { cache } from "react";
import { getDb } from "@/lib/data";

/**
 * Request-scoped assistant lookup: the editor layout and its page both need
 * the assistant row, React cache() collapses them to one query per request.
 */
export const getAssistantCached = cache(async (id: string) => {
  const db = await getDb();
  return db.getAssistant(id);
});
