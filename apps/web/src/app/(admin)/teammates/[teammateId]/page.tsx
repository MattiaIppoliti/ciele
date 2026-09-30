import { TeammateChat } from "@/components/teammates/teammate-chat";

export const dynamic = "force-dynamic";

/**
 * One Teammate: the chat. Its configuration is `/teammates/{id}/settings`.
 *
 * A retired Teammate still opens. It answers nothing more, but the
 * Conversations a Member had with it are readable only here, so a 404 would
 * delete the history that the soft delete exists to keep (#767, story 33).
 */
export default async function TeammatePage({
  params,
}: {
  params: Promise<{ teammateId: string }>;
}) {
  // `?c=` (a referral landing, a history link) is read by the chat itself
  // from the URL, so it also follows the changes the chat makes to it.
  const { teammateId } = await params;
  return <TeammateChat teammateId={teammateId} />;
}
