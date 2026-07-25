import { InboxClient } from "@/components/inbox/inbox-client";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const { organizationId, role, db, reads } = await requirePageMember();

  const [conversations, assistants] = await Promise.all([
    db.listInboxConversations(organizationId),
    reads.assistants(),
  ]);

  return (
    <InboxClient
      conversations={conversations}
      assistants={assistants.map((a) => ({ id: a.id, title: a.title }))}
      canEdit={canEdit(role)}
    />
  );
}
