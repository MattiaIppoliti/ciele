import Link from "next/link";
import { redirect } from "next/navigation";
import { DEFAULT_AUDIT_RETENTION_DAYS } from "@agent-hub/core";
import { listAuditLogOp } from "@ciele/ops";
import { auditEntityLinks } from "@/lib/audit-entity-links";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { AuditLogClient } from "@/components/settings/audit-log-client";
import { requirePageMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import { auditLogFilter, parseAuditLogView } from "@/lib/settings/audit-log";
import { describeDays } from "@/lib/settings/data-retention";

export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role, db, organizationId, session } = await requirePageMember();
  if (role !== "owner" && role !== "admin") redirect("/settings/profile");
  const view = parseAuditLogView(await searchParams);
  const [entries, members, apiKeys, teammates] = await Promise.all([
    runOperation(listAuditLogOp, auditLogFilter(view)),
    db.listMembers(organizationId),
    db.listApiKeys(organizationId),
    db.table("teammates").list({ organizationId }),
  ]);
  const links = await auditEntityLinks(db, entries);
  const retention = session.organization.auditRetentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS;
  return (
    <SettingsPanel
      title="Audit log"
      description={
        <>
          Who changed the Organization, where and when. Entries are kept for {describeDays(retention)}, set on the{" "}
          <Link href="/settings/data-retention" className="press-text underline underline-offset-4">
            Data retention
          </Link>{" "}
          tab.
        </>
      }
    >
      <AuditLogClient
        entries={entries}
        view={view}
        members={members}
        names={{
          apiKeys: Object.fromEntries(apiKeys.map((key) => [key.id, key.name])),
          teammates: Object.fromEntries(teammates.map((teammate) => [teammate.id, teammate.name])),
        }}
        links={links}
      />
    </SettingsPanel>
  );
}
