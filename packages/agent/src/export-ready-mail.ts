import { sendEmail } from "./email";
import { platformAppOrigin } from "./template";
import { nonRetryable } from "./job-errors";
import type { JobHandler } from "./jobs";
export const exportReadyMailHandler: JobHandler = {
  async perform(record, deps) {
    const jobId = record.payload.jobId;
    if (typeof jobId !== "string") throw nonRetryable("Invalid export notification job");
    const job = await deps.db.getExportJob(jobId);
    if (!job || job.organizationId !== record.organizationId || job.status !== "done" || !job.storagePath) return;
    const scheduleId = job.params.scheduleId;
    if (typeof scheduleId !== "string") return;
    const schedule = await deps.db.table("exportSchedules").get(scheduleId);
    if (!schedule || schedule.organizationId !== record.organizationId) return;
    const members = await deps.db.listMembers(record.organizationId);
    for (const member of members) {
      if (!schedule.recipientMemberIds.includes(member.userId)) continue;
      const delivery = await (deps.emailTransport ?? sendEmail)({ to: member.email, subject: "Your Insights export is ready", body: `Your scheduled Insights export is ready. Sign in to download it:\n${platformAppOrigin()}/insights/exports?job=${encodeURIComponent(job.id)}` }, { idempotencyKey: `export-ready:${job.id}:${member.userId}` });
      if (!delivery.delivered) throw new Error(`Export notification ${delivery.reason}`);
    }
    await deps.db.resolveAlertsByKey(record.organizationId, `scheduled-export-mail:${scheduleId}`);
  },
  async onTerminalFailure(record, deps) {
    const jobId = record.payload.jobId;
    const job = typeof jobId === "string" ? await deps.db.getExportJob(jobId) : null;
    if (job?.organizationId === record.organizationId && typeof job.params.scheduleId === "string") await deps.db.raiseAlert(record.organizationId, { type: "integration", title: "Scheduled export email failed", detail: "The export is available in Insights → Exports. Check the email transport.", sourceKey: `scheduled-export-mail:${job.params.scheduleId}` });
  },
};
