import type { Assistant, Flow, Role, Teammate } from "./types";

/**
 * The AI Teammate derivations (#768): who may see one, who may change one, and
 * what its persona says to the model.
 *
 * All four are pure functions of the row plus the asking Member, which is what
 * lets the same rule run in the operations layer, in a server component, and in
 * a test with no database. Enforcement still happens server-side: these decide,
 * the ops layer refuses.
 */

/** The asking Member: their id and their organization Role. */
export interface TeammateViewer {
  userId: string;
  role: Role;
}

/** Owner and Admin administer the Organization; Editor and Viewer do not. */
function isOrgAdmin(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Whether this turn should get a knowledge-search tool at all.
 *
 * An empty Knowledge Scope is a configuration, not an omission: the Member
 * wanted a persona (a copywriter, a rubber duck), so the runtime registers no
 * search tool rather than one that always answers "nothing found". A model with
 * a tool that never returns anything keeps calling it.
 */
export function teammateSearchesKnowledge(
  teammate: TeammateKnowledgeScope
): boolean {
  return teammate.collectionIds.length + teammate.sourceIds.length > 0;
}

/**
 * The two halves of a Knowledge Scope, as the one shape every consumer asks
 * about it with. Whole Collections and individual Library Sources are a union,
 * so "does this Teammate search anything" is a question about both lists and
 * must never be asked of one.
 */
export type TeammateKnowledgeScope = Pick<
  Teammate,
  "collectionIds" | "sourceIds"
>;

/**
 * The Standing Role as a prompt layer (#767): the one thing that makes a
 * Teammate feel like a colleague rather than the website widget wearing a name.
 *
 * It sits above the organization's answering style and below the platform
 * prompt, and it is read at turn time, so an edit lands on the next turn. A
 * Teammate has no Publication, so there is nothing to republish.
 *
 * The scopeless case is stated explicitly. Without it the model has a persona
 * telling it what it is for and no way to look anything up, and it fills that
 * gap by inventing the organization's facts.
 */
export function teammatePersonaPrompt(
  teammate: Pick<Teammate, "name" | "title" | "roleDescription"> &
    TeammateKnowledgeScope
): string {
  const name = teammate.name.trim() || "your AI teammate";
  const title = teammate.title.trim();
  const role = teammate.roleDescription.trim();
  const lines = [
    title
      ? `You are ${name}, the ${title} on this organization's team.`
      : `You are ${name}, an AI teammate on this organization's team.`,
    "You are talking to a colleague inside the organization's own workspace, not to a member of the public.",
    role ? `What you are here to do, in their words:\n${role}` : undefined,
    teammateSearchesKnowledge(teammate)
      ? undefined
      : "You have no knowledge to search this turn: state no facts about this organization, its customers, its data or its history, and say plainly when something would need a source you do not have.",
  ];
  return lines.filter((line): line is string => typeof line === "string").join("\n");
}

/**
 * Whether a Teammate has been soft-deleted. Retired, not gone: it answers
 * nothing more, and the Conversations it already had stay readable (#767).
 */
export function isTeammateRetired(
  teammate: Pick<Teammate, "deletedAt">
): boolean {
  return teammate.deletedAt !== null;
}

/**
 * Whether a Member may look at this Teammate at all: its configuration, and the
 * Conversations they had with it.
 *
 * Permission only, deliberately blind to the tombstone. A soft delete has to
 * leave past Conversations readable, and the only surface that holds them is
 * the Teammate's own thread, so a rule that hid a retired Teammate from its
 * owner would take the transcripts with it. What the tombstone does gate is
 * everything forward-looking: the roster (`visibleTeammates`), edits
 * (`canEditTeammate`) and new turns (the chat route).
 *
 * A named editor is included, not only the owner and the admins: a colleague
 * who may edit a private Teammate but may not open it would hold a right they
 * cannot exercise.
 */
export function canViewTeammate(
  teammate: Pick<Teammate, "ownerId" | "editorIds" | "visibility">,
  viewer: TeammateViewer
): boolean {
  if (teammate.visibility === "org") return true;
  return (
    teammate.ownerId === viewer.userId ||
    teammate.editorIds.includes(viewer.userId) ||
    isOrgAdmin(viewer.role)
  );
}

/**
 * Whether a Member may change this Teammate's configuration.
 *
 * The organization Role is the ceiling: naming a Viewer as a Teammate editor
 * does not hand them an edit right their Role denies them everywhere else.
 * Above that floor it is the ownership rule, the owner, whoever they named, and
 * the organization's admins.
 */
export function canEditTeammate(
  teammate: Pick<
    Teammate,
    "ownerId" | "editorIds" | "visibility" | "deletedAt"
  >,
  viewer: TeammateViewer
): boolean {
  if (isTeammateRetired(teammate)) return false;
  if (viewer.role === "viewer") return false;
  return (
    teammate.ownerId === viewer.userId ||
    teammate.editorIds.includes(viewer.userId) ||
    isOrgAdmin(viewer.role)
  );
}

/**
 * The roster: every live Teammate this Member may see, order preserved. A
 * retired one leaves the list, because a card nobody can chat with is an
 * invitation to a dead end.
 */
export function visibleTeammates<
  T extends Pick<Teammate, "ownerId" | "editorIds" | "visibility" | "deletedAt">,
>(teammates: readonly T[], viewer: TeammateViewer): T[] {
  return teammates.filter(
    (teammate) => !isTeammateRetired(teammate) && canViewTeammate(teammate, viewer)
  );
}

/**
 * The roster as one Member wants to see it: what they may see, minus what they
 * hid (#767, story 10).
 *
 * Separate from {@link visibleTeammates} because the two rules answer different
 * questions and only one of them is about permission. Visibility decides what a
 * Member is *allowed* to see, and the chat route, the referral candidates and
 * every guard go through it. Hiding is a preference about a list, so it belongs
 * to the list and nowhere else: a hidden Teammate still answers this Member if
 * they open it by URL, still appears as a referral target, and is completely
 * unaffected for everybody else.
 *
 * The composition only ever narrows. Passing an id that is not hidden is not a
 * way to widen what the visibility rule already refused.
 */
export function rosterTeammates<
  T extends Pick<Teammate, "id" | "ownerId" | "editorIds" | "visibility" | "deletedAt">,
>(
  teammates: readonly T[],
  viewer: TeammateViewer,
  hiddenTeammateIds: readonly string[]
): T[] {
  const hidden = new Set(hiddenTeammateIds);
  return visibleTeammates(teammates, viewer).filter(
    (teammate) => !hidden.has(teammate.id)
  );
}

/**
 * The Teammate as runtime configuration.
 *
 * The chat runtime answers a turn from an `Assistant`-shaped config: which
 * model, which tools, what persona. A Teammate is that same config arriving
 * from a different row, so rather than teach the runtime a second config shape
 * (and re-derive "which model does this turn run on" twice), the Teammate
 * projects onto the one it already speaks.
 *
 * Everything widget-shaped is neutral here because a Teammate has none of it:
 * no welcome card, no disclaimer, no launcher, no allowed domains, no sign-in
 * gate, no help desks. The persona does NOT ride `answeringStyle`, that field
 * is the Organization's instruction to its public Assistant; the Teammate's
 * persona is its own prompt layer (see {@link teammatePersonaPrompt}).
 *
 * The `id` is the Teammate's, which makes it wrong to write into any column
 * that references an Assistant. The runtime attributes a Teammate turn's
 * telemetry and usage to no Assistant at all (#768).
 *
 * `knowledgeEngine` is vector because the Knowledge Graph is derived per
 * Assistant (ADR-0017) and a Teammate is not one; its retrieval is the
 * pgvector search over the Collections in its scope.
 */
export function teammateRuntimeAssistant(teammate: Teammate): Assistant {
  return {
    id: teammate.id,
    organizationId: teammate.organizationId,
    title: teammate.name,
    nickname: teammate.name,
    description: teammate.title,
    welcomeMessage: "",
    aiDisclaimer: "",
    suggestedQuestions: [],
    quickReplies: [],
    answeringStyle: "",
    simplifiedThinking: false,
    chatLauncherEnabled: false,
    modelProvider: teammate.modelProvider,
    modelId: teammate.modelId,
    style: {},
    allowedDomains: [],
    // No escalation: a colleague who needs a human asks one, they do not need
    // the widget's contact-support ramp.
    helpDeskSettings: {},
    tools: {},
    requireSignIn: false,
    knowledgeEngine: "vector",
    createdAt: teammate.createdAt,
    updatedAt: teammate.updatedAt,
  };
}

/**
 * The one implicit Flow a Teammate turn routes to.
 *
 * Flows are the Assistant's authoritative router, and a Teammate has none: a
 * colleague asks whatever they want, and the answer is always the generative
 * default. Rather than special-case the engine, the turn hands it a single
 * built-in Default behavior flow, which is exactly the routing an Assistant
 * with no matching flow already gets (an actionless built-in runs
 * `search_knowledge`).
 */
export function teammateDefaultFlow(teammate: Pick<Teammate, "id">): Flow {
  return {
    id: `teammate-default:${teammate.id}`,
    // No Assistant exists; the field carries the Teammate so a persisted flow
    // marker still names something real.
    assistantId: teammate.id,
    name: "Teammate",
    description: "Anything a colleague asks this Teammate",
    builtIn: true,
    enabled: true,
    position: 0,
    trigger: "message",
    triggerSettings: {},
    conditionLogic: "any",
    conditions: [],
    actions: [],
    actionSettings: {},
    customMessage: "",
    isDefault: true,
  };
}

/**
 * What the operational surface says when a deleted Knowledge Collection is
 * still in somebody's scope (#769).
 *
 * Here rather than beside the `Db` call that raises it, because picking the
 * words is a pure function of the Collection's name and who was searching it,
 * and a copy change should not need a database to test.
 *
 * `collectionLabel` is whatever the caller can still say about the Collection:
 * the delete path holds the row and passes its name; the added-scope path
 * (#769 review) is naming a Collection that never existed here, so the id is
 * all there is to show.
 */
export function danglingScopeAlertCopy(
  collectionLabel: string,
  teammateNames: readonly string[]
): { title: string; detail: string } {
  return danglingCopy("collection", collectionLabel, teammateNames);
}

/**
 * The same, for an individual Library Source in a scope: a website, a file or an
 * FAQ that was deleted while a Teammate still named it.
 *
 * A second entry point over one shared builder rather than a second copy of the
 * sentence: the two Alerts differ only in the noun, and a wording change that
 * landed on one of them would read as two different products.
 */
export function danglingSourceScopeAlertCopy(
  sourceLabel: string,
  teammateNames: readonly string[]
): { title: string; detail: string } {
  return danglingCopy("source", sourceLabel, teammateNames);
}

function danglingCopy(
  kind: "collection" | "source",
  label: string,
  teammateNames: readonly string[]
): { title: string; detail: string } {
  const one = teammateNames.length === 1;
  const noun =
    kind === "collection" ? "knowledge collection" : "library item";
  return {
    title: `Deleted ${kind === "collection" ? "collection" : "library item"} still in a teammate's knowledge: ${label}`,
    detail: `${teammateNames.join(", ")} ${one ? "searches" : "search"} a ${noun} that no longer exists, so ${one ? "it finds" : "they find"} nothing there. Edit the teammate's knowledge to clear it.`,
  };
}
