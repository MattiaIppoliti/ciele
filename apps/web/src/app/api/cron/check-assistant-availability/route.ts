import { withCronAuth } from "@/lib/cron-auth";
import { getWidgetDb } from "@/lib/widget-db";
import { internalApiOrigin } from "@/lib/internal-origin";
import { probeAssistantAvailability } from "@/lib/assistant-availability-probe";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withCronAuth(async () => {
  const db = getWidgetDb();
  const targets = await db.listPublishedAvailabilityTargets(null, 200);
  let checked = 0,
    failed = 0;
  for (let offset = 0; offset < targets.length; offset += 10) {
    const checks = await Promise.all(
      targets
        .slice(offset, offset + 10)
        .map((target) =>
          probeAssistantAvailability(target, internalApiOrigin()),
        ),
    );
    await db.recordAssistantAvailability(checks);
    checked += checks.length;
    failed += checks.filter((c) => c.status === "down").length;
  }
  return Response.json({ checked, failed });
});
