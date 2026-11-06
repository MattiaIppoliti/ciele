import type { Flow } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

/** Every routing entry, including handover, reads the same live calendars. */
export async function liveBusinessHours(db: Db, organizationId: string, flows: readonly Flow[]) {
  if (!flows.some(flow => flow.conditions.some(condition => condition.kind === "schedule" && condition.mode === "business_hours"))) return [];
  try { return await db.table("businessHours").list({ organizationId }); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && ["42P01", "PGRST205"].includes(String(error.code))) return [];
    throw error;
  }
}
