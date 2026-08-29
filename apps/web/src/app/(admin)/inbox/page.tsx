import { InboxClient } from "@/components/inbox/inbox-client";
import { requirePageMember } from "@/lib/authz";
import { canEdit, canManageMembers, canViewReasoning } from "@/lib/rbac";
import {
  defaultInboxFilters,
  inboxQueryFromFilters,
} from "@/lib/inbox/conversation-filter";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, role, db, reads } = await requirePageMember();
  const params = await searchParams;
  const requested =
    typeof params.conversation === "string" ? params.conversation : null;
  const initialQuery = inboxQueryFromFilters(
    { ...defaultInboxFilters(), search: "" },
    { limit: 50 },
  );

  const [page, requestedPage, assistants] = await Promise.all([
    db.getInboxPage(organizationId, initialQuery),
    requested
      ? db.getInboxPage(organizationId, {
          conversationIds: [requested],
          staff: "include",
          limit: 1,
        })
      : null,
    reads.assistantShellSummaries(),
  ]);
  const requestedConversation = requestedPage?.conversations[0];
  const conversations = requestedConversation
    ? [
        requestedConversation,
        ...page.conversations.filter((row) => row.id !== requestedConversation.id),
      ]
    : page.conversations;

  return (
    <InboxClient
      initialPage={{ ...page, conversations }}
      assistants={assistants.map((a) => ({ id: a.id, title: a.title }))}
      canEdit={canEdit(role)}
      canViewReasoning={canViewReasoning(role)}
      // The channel oversight read is `manageMembers`, so the link only appears
      // for the Roles that could follow it (#778).
      canOverseeChannels={canManageMembers(role)}
    />
  );
}
