import { notFound } from "next/navigation";
import { PageCrumb } from "@/components/shell/top-bar-slots";
import { HelpDeskManage } from "@/components/help-desks/help-desk-manage";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function ManageHelpDeskPage({
  params,
}: {
  params: Promise<{ deskId: string }>;
}) {
  const { deskId } = await params;
  const { organizationId, role, db } = await requirePageMember();

  const desk = await db.getHelpDesk(deskId);
  if (!desk || desk.organizationId !== organizationId) notFound();
  const channels = await db.listSupportChannels(desk.id);

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

  return (
    <>
      <PageCrumb label={desk.name} />
    <HelpDeskManage
      desk={safeDesk}
      channels={channels}
      canEdit={canEdit(role)}
    />
    </>
  );
}
