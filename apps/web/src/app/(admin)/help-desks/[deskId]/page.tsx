import { notFound } from "next/navigation";
import { PageCrumb } from "@/components/shell/top-bar-slots";
import { HelpDeskManage } from "@/components/help-desks/help-desk-manage";
import { requirePageMember } from "@/lib/authz";
import { can } from "@/lib/rbac";
import { ticketingConnectionOptions } from "@/lib/ticketing-integrations";

export const dynamic = "force-dynamic";

export default async function ManageHelpDeskPage({
  params,
}: {
  params: Promise<{ deskId: string }>;
}) {
  const { deskId } = await params;
  const { organizationId, role, db, capabilities } = await requirePageMember();
  const access = { role, capabilities };

  const desk = await db.getHelpDesk(deskId);
  if (!desk || desk.organizationId !== organizationId) notFound();
  const [channels, connections, members, operators] = await Promise.all([
    db.listSupportChannels(desk.id),
    db.listApplicationConnections(organizationId),
    db.listMembers(organizationId),
    // One migration behind (#1084 not applied): the desk simply has none yet.
    db.table("helpDeskOperators").list({ helpDeskId: desk.id }).catch(() => []),
  ]);

  // Never send the sealed clientSecret/password ciphertext to the browser.
  const safeDesk = {
    ...desk,
    ticketingIntegration: desk.ticketingIntegration
      ? {
          ...desk.ticketingIntegration,
          config: {
            ...desk.ticketingIntegration.config,
            clientSecret: "",
            password: "",
          },
        }
      : null,
  };
  // Only the fields the picker renders, never the Connection's credential.
  const ticketingConnections = ticketingConnectionOptions(
    connections.map(({ id, provider, name, status, ownerType }) => ({
      id,
      provider,
      name,
      status,
      ownerType,
    })),
  );

  return (
    <>
      <PageCrumb label={desk.name} />
    <HelpDeskManage
      desk={safeDesk}
      channels={channels}
      canEdit={can(access, "helpDesks:edit")}
      ticketingConnections={ticketingConnections}
      members={members.map((member) => ({
        userId: member.userId,
        name:
          [member.firstName, member.lastName].filter(Boolean).join(" ") ||
          member.username ||
          member.email,
      }))}
      operators={operators.map((row) => ({ memberId: row.memberId, capacity: row.capacity }))}
    />
    </>
  );
}
