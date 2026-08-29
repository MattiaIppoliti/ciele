import type { ConversationMetadata, Teammate } from "./types";
import { visibleTeammates } from "./teammate";
import type { TeammateViewer } from "./teammate";

/**
 * Teammate referral (#773): handing a request to a colleague who is better
 * placed to answer it.
 *
 * Human-mediated on purpose. The referring Teammate produces a card, and that
 * is the end of its involvement: the target never speaks in the origin
 * transcript, and nothing runs until the Member clicks. Stage 2 (channels) is
 * where agents talk to each other; stage 1 is an agent telling a person who
 * else to ask.
 *
 * The rule that carries the weight is who may be suggested. A Teammate must
 * never name a private one it cannot see, because the suggestion itself would
 * leak that it exists (the same reason `canViewTeammate` refuses with
 * `not_found` rather than "forbidden").
 */

/** What the model is told about one colleague it could refer to. */
export interface ReferralCandidate {
  id: string;
  name: string;
  /** Its title and Standing Role, so the model can pick on substance. */
  description: string;
}

/** How much of a Standing Role the model reads when choosing. */
const ROLE_PREVIEW_CHARS = 300;

/**
 * Who this Teammate may refer the Member to.
 *
 * Filtered through `visibleTeammates` against the **Member's** viewer, not the
 * Teammate's: the card is an instruction to a person, so suggesting something
 * they cannot open would be a dead end, and suggesting a private Teammate they
 * are not on would disclose it. Retired ones are out for the same reason
 * they leave the roster, and the origin excludes itself because "ask me" is
 * not a referral.
 */
export function referralCandidates(
  teammates: readonly Teammate[],
  origin: Pick<Teammate, "id">,
  viewer: TeammateViewer
): ReferralCandidate[] {
  return visibleTeammates(teammates, viewer)
    .filter(
      (teammate) => teammate.id !== origin.id && teammate.visibility === "org"
    )
    .map((teammate) => ({
      id: teammate.id,
      name: teammate.name,
      description: describeCandidate(teammate),
    }));
}

/**
 * Only org-visible Teammates are offered, even to a Member who can see a
 * private one.
 *
 * A referral card is a public act inside the conversation: the Member may
 * forward it, and the transcript keeps it. A private Teammate is private from
 * the roster outward, so it stays out of the one place a Teammate would name
 * colleagues unprompted. Someone who owns a private Teammate can still open it
 * themselves; what they will not get is an agent volunteering its existence.
 */
function describeCandidate(
  teammate: Pick<Teammate, "title" | "roleDescription">
): string {
  const title = teammate.title.trim();
  const role = teammate.roleDescription.trim().slice(0, ROLE_PREVIEW_CHARS);
  return [title, role].filter(Boolean).join(". ") || "No role described yet";
}

/**
 * What the referring Teammate is told about referring, or null when there is
 * nobody to refer to.
 *
 * Null rather than an empty list is the point: with no colleagues, the tool is
 * not registered and the model is never told referral exists. A model holding
 * a tool it can never usefully call reaches for it anyway, and an organization
 * with one Teammate would get "let me hand you to..." with nowhere to go.
 */
export function referralPromptSection(
  candidates: readonly ReferralCandidate[]
): string | null {
  if (candidates.length === 0) return null;
  return [
    "# Colleagues you can refer to",
    "These are the other AI teammates in this organization. When a request is outside what you are for, or outside what you can look up, refer the person to whichever one fits and say why. Referring is better than a vague answer, and much better than guessing.",
    "Do not refer for something you can do yourself, and do not refer more than once in a turn.",
    ...candidates.map(
      (candidate) => `- ${candidate.name}: ${candidate.description}`
    ),
  ].join("\n");
}

/**
 * The context a referred-to Teammate reads at the start of its first turn.
 *
 * Rendered as standing context rather than as a message, because it is neither
 * the Member's words nor this Teammate's: attributing it to the Member would
 * make it look like they typed a summary of themselves, which is both false
 * and the sort of thing that gets quoted back at them.
 */
export function referralContextSection(
  metadata: Pick<
    ConversationMetadata,
    "referredFromTeammateName" | "referralSummary"
  > | null | undefined
): string | null {
  const summary = metadata?.referralSummary?.trim();
  if (!summary) return null;
  const from = metadata?.referredFromTeammateName?.trim();
  return [
    "# Why you are in this conversation",
    from
      ? `${from}, another teammate here, referred this colleague to you. This is what they told you, not what the colleague said:`
      : "Another teammate referred this colleague to you. This is what they told you, not what the colleague said:",
    summary,
    "Pick it up from there. Do not make them repeat themselves, and do not answer as though you had been in that conversation.",
  ].join("\n");
}

/**
 * The standing context a Teammate turn reads: its memory layers first, then the
 * referral that opened the conversation, if it was one.
 *
 * One function rather than two shapes joined at the call site, because that
 * join is where this went wrong: the referral section is a `string | null` and
 * the memory layers are a list, and spreading the former into the latter split
 * the summary into one array element per character. The runtime renders each
 * element as its own paragraph, so the model was handed the summary a letter at
 * a time and read it as noise.
 */
export function standingContextSections(
  memorySections: readonly string[],
  metadata: Pick<
    ConversationMetadata,
    "referredFromTeammateName" | "referralSummary"
  > | null | undefined
): string[] {
  const referral = referralContextSection(metadata);
  return referral ? [...memorySections, referral] : [...memorySections];
}

/** Whether this Conversation began as a referral from another Teammate. */
export function isReferredConversation(
  metadata: Pick<ConversationMetadata, "referredFromConversationId"> | null | undefined
): boolean {
  return Boolean(metadata?.referredFromConversationId);
}
