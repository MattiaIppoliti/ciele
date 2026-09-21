import { notFound } from "next/navigation";
import {
  canEditTeammate,
  isTeammateRetired,
  visibleTeammates,
} from "@agent-hub/core";
import { chatModelOptions } from "@agent-hub/agent";
import { TeammateWorkspace } from "@/components/teammates/teammate-workspace";
import { requirePageMember } from "@/lib/authz";
import { findVisibleTeammate } from "@/lib/teammates/access";

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
  searchParams,
}: {
  params: Promise<{ teammateId: string }>;
  /**
   * `?c=` opens one past Conversation directly. Accepting a referral (#773)
   * navigates here with it, and that link is the whole handoff: without it the
   * Member lands on an empty chat and the summary the referring Teammate wrote
   * sits unread in a conversation they would have to hunt for in the history.
   */
  searchParams: Promise<{ c?: string }>;
}) {
  const { teammateId } = await params;
  const { c: initialConversationId } = await searchParams;
  const { organizationId, role, session, db } = await requirePageMember();

  const viewer = { userId: session.userId, role: role ?? "viewer" };
  const teammate = await findVisibleTeammate(
    db,
    organizationId,
    teammateId,
    viewer
  );
  if (!teammate) notFound();

  // The thread, plus what the composer needs. Still not the settings payload
  // (#922): Collections, Library items, members, grants, Projects, memory and
  // Routines belong to `/teammates/{id}/settings` and no longer load on every
  // chat open. What stayed are four small reads the composer cannot draw
  // itself without.
  const [thread, connections, personalAllowed, roster, orgSkills] =
    await Promise.all([
    db.listTeammateConversations(teammate.id, session.userId),
    db.listProviderConnections(organizationId),
    // The Organization's opt-in, not this Member's pairing. Whether they
    // personally have a subscription connected costs a relay round trip and a
    // CLI probe, which is too much for a page render; the opt-in is one read
    // and answers the only question the composer needs, "could one be in
    // charge here". Off, the common case, means the picker is the whole story.
    db.getPersonalAiSubscriptionsAllowed(organizationId),
    // Who `@` can name in this chat. Resolved against the **Member's** own
    // visibility, not the Teammate's referral rule (#773): there the Teammate
    // volunteers a colleague and a private one must stay unnamed, here the
    // Member picks somebody they can already see on their own roster.
    db.table("teammates").list({ organizationId }),
    // The Organization's Skills, not an attachment list: `assistant_skills`
    // decides whose *prompt* a Skill layers into, and a Teammate is not an
    // Assistant. For `/` the Skill is only an opening line, so every one the
    // Organization wrote is offerable.
    db.table("skills").list({ organizationId }),
  ]);

  const skills = orgSkills
    .filter((skill) => (skill.starter ?? "").trim().length > 0)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      starter: skill.starter,
    }));

  const channelCandidates = visibleTeammates(roster, viewer)
    .filter((candidate) => candidate.id !== teammate.id)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      title: candidate.title,
    }));

  // Capability, resolved server-side: this page is already dynamic and
  // authenticated, so unlike the widget there is nothing to fetch later.
  const models = chatModelOptions(
    { provider: teammate.modelProvider, modelId: teammate.modelId },
    teammate.allowedModels,
    connections
  );

  return (
    <TeammateWorkspace
      teammate={teammate}
      thread={thread.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        // Carries the Routine marker so the list can label unattended runs.
        metadata: c.metadata,
      }))}
      canEdit={canEditTeammate(teammate, viewer)}
      retired={isTeammateRetired(teammate)}
      initialConversationId={initialConversationId ?? null}
      models={models}
      personalSubscriptionsAllowed={personalAllowed}
      channelCandidates={channelCandidates}
      skills={skills}
    />
  );
}
