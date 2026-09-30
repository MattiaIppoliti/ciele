import { TeammateChat } from "@/components/teammates/teammate-chat";
import { requirePageMember } from "@/lib/authz";
import { ensureCieleAi } from "@/lib/teammates/ciele-ai";

export const dynamic = "force-dynamic";

/**
 * `/teammates`: the Chat surface's landing page, which is the Organization's
 * Ciele AI (the default AI layer over the whole platform).
 *
 * It used to be a "pick a teammate" placeholder. Chat now opens ready to ask,
 * the same shape Notion AI opens in: the face, the question, the composer. A
 * Teammate is one click away in the sidebar; Ciele AI is the thing you do not
 * have to pick. `?c=` reopens one of its past Conversations, like on any
 * Teammate's page; the chat reads it from the URL.
 */
export default async function TeammatesPage() {
  const { organizationId, session } = await requirePageMember();
  const cieleAi = await ensureCieleAi(organizationId, session.userId);
  return <TeammateChat teammateId={cieleAi.id} resolved={cieleAi} />;
}
