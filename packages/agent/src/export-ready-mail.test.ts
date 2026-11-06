import { expect, it, vi } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { runDueJobs } from "./jobs";
const db = getMockDb();
it("emails only current Members after the file commits, with a sign-in link and a stable delivery key", async () => {
  const schedule = await db.table("exportSchedules").insert({ organizationId: DEMO_ORG.id, name: "Private report name", kind: "insights_overview", format: "csv", filters: {}, cadence: { kind: "weekly", weekday: 1 }, hour: 8, recipientMemberIds: [DEMO_MEMBER.userId, "departed-member"] });
  const job = await db.createExportJob(DEMO_ORG.id, { kind: "insights_overview", format: "csv", params: { scheduleId: schedule.id, confidentialFigure: "987654321" } });
  const emailTransport = vi.fn(async () => ({ delivered: true as const }));
  await runDueJobs({ db, emailTransport }, { kinds: ["notify_export_ready"], limit: 10 });
  expect(emailTransport).not.toHaveBeenCalled();
  await db.updateExportJob(job.id, { status: "done", storagePath: "private/export.csv" });
  await runDueJobs({ db, emailTransport }, { kinds: ["notify_export_ready"], limit: 10 });
  expect(emailTransport).toHaveBeenCalledTimes(1);
  expect(emailTransport).toHaveBeenCalledWith(expect.objectContaining({ to: DEMO_MEMBER.email, subject: "Your Insights export is ready", body: expect.stringContaining(`/insights/exports?job=${encodeURIComponent(job.id)}`) }), { idempotencyKey: `export-ready:${job.id}:${DEMO_MEMBER.userId}` });
  expect(JSON.stringify(emailTransport.mock.calls)).not.toMatch(/987654321|private\/export.csv|Private report name/);
  await runDueJobs({ db, emailTransport }, { kinds: ["notify_export_ready"], limit: 10 });
  expect(emailTransport).toHaveBeenCalledTimes(1);
});
