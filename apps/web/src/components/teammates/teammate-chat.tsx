import { notFound, redirect } from "next/navigation";
import {
  isCieleAi,
  isTeammateRetired,
  visibleTeammates,
  type Teammate,
} from "@agent-hub/core";
import { chatModelCandidates, chatModelOptions } from "@agent-hub/agent";
import { TeammateWorkspace } from "@/components/teammates/teammate-workspace";
import { requirePageMember } from "@/lib/authz";
import { starterSkills } from "@/lib/composer/skills";
import { findVisibleTeammate } from "@/lib/teammates/access";
import { PageCrumb } from "@/components/shell/top-bar-slots";
import { listPlatformEvalModels } from "@/lib/platform";
import { chatAllowedModels } from "@/lib/teammates/ciele-ai";

/**
 * One Teammate's chat, as both routes that open one render it:
 * `/teammates/{id}` for a Teammate, and `/teammates` itself for the
 * Organization's Ciele AI, which opens there as the Chat surface's landing
 * page.
 */
export async function TeammateChat({
  teammateId,
  resolved,
}: {
  teammateId: string;
  /**
   * Already read by the caller, so the index page does not read it twice.
   * Only `/teammates` itself, Ciele AI's one address, passes it.
   */
  resolved?: Teammate;
}) {
  const landing = resolved !== undefined;
  const { organizationId, role, session, db } = await requirePageMember();

  const viewer = { userId: session.userId, role: role ?? "viewer" };
  const teammate =
    resolved ?? (await findVisibleTeammate(db, organizationId, teammateId, viewer));
  if (!teammate) notFound();
  // Ciele AI lives at `/teammates`. Its id URL is still reachable, from the
  // Configure page's way back for one, and it lands on the one page instead.
  if (isCieleAi(teammate) && !landing) redirect("/teammates");

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

  const skills = starterSkills(orgSkills);

  const channelCandidates = visibleTeammates(roster, viewer)
    .filter((candidate) => candidate.id !== teammate.id)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      title: candidate.title,
    }));

  // Capability, resolved server-side: this page is already dynamic and
  // authenticated, so unlike the widget there is nothing to fetch later.
  const modelCandidates = isCieleAi(teammate) ? chatModelCandidates : chatModelOptions;
  const models = teammate.runtimeConfig?.harness.kind === "ag_ui" ? [] : modelCandidates(
    { provider: teammate.modelProvider, modelId: teammate.modelId, source: teammate.modelSource ?? undefined },
    chatAllowedModels(teammate),
    connections,
    await listPlatformEvalModels(),
    { includeUnavailable: isCieleAi(teammate) },
  );
  if (isCieleAi(teammate)) {
    // Keep askable choices before the unavailable diagnostics, as this picker
    // has always done; capability itself preserves the configured ordering.
    models.sort((a, b) => Number(Boolean(a.unavailable)) - Number(Boolean(b.unavailable)));
  }
  // "Auto" leads any picker: the best model of the latest Eval, else the
  // configured one, which the chat route resolves on every send.
  const autoModel = models.length > 0;

  return (
    <>
    {/* Names the Teammate in the breadcrumb. The landing page is `/teammates`
        itself, which the route already names. */}
    {!landing && <PageCrumb label={teammate.name} />}
    <TeammateWorkspace
      teammate={teammate}
      thread={thread.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        // Carries the Routine marker so the list can label unattended runs.
        metadata: c.metadata,
      }))}
      retired={isTeammateRetired(teammate)}
      models={models}
      autoModel={autoModel}
      personalSubscriptionsAllowed={personalAllowed}
      channelCandidates={channelCandidates}
      skills={skills}
    />
    </>
  );
}
