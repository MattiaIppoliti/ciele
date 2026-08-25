import type { TeammateActionDomain, TeammateGrantDomain } from "@agent-hub/core";
import {
  actionRefusal,
  ceilingAllowsCapability,
  mayAcceptSuggestedFix,
} from "@agent-hub/core";
import type { MutatedEntity } from "./entities";
import {
  OperationError,
  type Operation,
  type OperationContext,
  type TeammateActor,
} from "./operation";
import {
  getImprovementOp,
  listImprovementsOp,
  updateImprovementOp,
  acceptSuggestedFixOp,
  dismissSuggestedFixOp,
  proposeSuggestedFixOp,
  triageFeedbackOp,
} from "./improvements";
import {
  getConversationOp,
  listInboxConversationsOp,
  setConversationPinnedOp,
} from "./inbox";
import { listAssistantsOp } from "./assistants";
import { recordProjectDecisionOp, rememberAboutMemberOp } from "./memory";
import {
  createOrgFaqOp,
  getOrgFaqOp,
  listCollectionsOp,
  listOrgFaqsOp,
  listOrgKnowledgeSourcesOp,
  updateOrgFaqOp,
} from "./knowledge";

/**
 * What a granted domain actually lets an AI Teammate do (#770).
 *
 * The spec's line is "granted domains' operations from the ops layer become
 * turn tools", and the honest reading of that is *curated*, not *all*. There
 * are ~130 operations; a Teammate handed 19 knowledge tools would spend its
 * turn choosing between them, and two of those 19 delete things. So each domain
 * lists the operations that make sense for a colleague to ask for in a
 * sentence, and the list is the contract, checked by a test that pins it.
 *
 * Three exclusions are deliberate rather than incidental, and the coverage test
 * asserts each one by name:
 *
 * - **`inbox.conversations.delete`** declares `capability: "member"` (an
 *   intentional choice for API keys, see the note in `inbox.ts`), so a *member*
 *   ceiling would admit it. Destroying a customer conversation is not something
 *   any ceiling should buy, so it is off the list entirely.
 * - **`knowledge.sources.delete` / `.unlink`** would let a Teammate at the
 *   default `edit` ceiling remove the organization's knowledge. Adding a FAQ is
 *   reversible by editing it; removing a crawled Source is not.
 * - **Everything publish-and-above.** Nothing here declares `publish`, so the
 *   third ceiling rung currently buys nothing. That is on purpose: the rung
 *   exists so raising it later is a decision, not a schema migration.
 *
 * Adding a domain costs one entry here plus the check constraint. Adding an
 * operation to an existing domain costs one line and a test update, which is
 * the friction we want in front of "the Teammate can now also…".
 */

/**
 * An operation stored in the catalogue, its input and output erased. The
 * catalogue is heterogeneous by nature and every caller re-parses through
 * `operation.input` anyway, so the erased form loses nothing real.
 */
export type CatalogedOperation = Operation<unknown, unknown>;

export interface TeammateActionSpec {
  operation: CatalogedOperation;
  /**
   * The grant that put it on the list, shown on the transcript card, or
   * `memory` for the two ungated memory writes, which have no grant row.
   */
  domain: TeammateActionDomain;
  /**
   * Short phrase the Thinking panel shows while the call runs ("Move an
   * improvement"). Beside the description because both are user-visible copy
   * about the same action, and splitting them across two files is how they
   * drift.
   */
  label: string;
  /**
   * What the model is told the tool does. Written as an instruction to a
   * colleague, not as an API summary, and it names the consequence when there
   * is one ("a colleague still has to accept it").
   */
  description: string;
  /**
   * A gate beyond domain + ceiling. Only the accept path has one: the ADR-0017
   * amendment is a per-Teammate decision, not a domain.
   */
  requires?: (actor: TeammateActor) => boolean;
}

const IMPROVEMENTS: TeammateActionSpec[] = [
  {
    operation: listImprovementsOp,
    label: "Read the improvements board",
    domain: "improvements",
    description:
      "List the answer-quality improvements on this organization's board, with their status, priority and assignee.",
  },
  {
    operation: getImprovementOp,
    label: "Read an improvement",
    domain: "improvements",
    description:
      "Read one improvement in full: its description, the flagged answers linked to it, and any Suggested Fix already drafted.",
  },
  {
    operation: updateImprovementOp,
    label: "Move an improvement",
    domain: "improvements",
    description:
      "Move an improvement on the board: change its status, priority, assignee, tags or due date.",
  },
  {
    operation: proposeSuggestedFixOp,
    label: "Draft a Suggested Fix",
    domain: "improvements",
    description:
      "Draft a Suggested Fix for an improvement: the FAQ question and answer that would have let the assistant answer correctly. This only drafts it. Unless you have been granted approval-bypass, a colleague still has to accept it before it becomes knowledge.",
  },
  {
    operation: triageFeedbackOp,
    label: "Triage recent feedback",
    domain: "improvements",
    description:
      "Scan the conversations visitors rated down recently and file the new problems on the improvements board. It deduplicates against what is already open, attaches the flagged answers as evidence, files at most 5 new items per run, and labels each one so a colleague can see what you filed. Takes no arguments.",
  },
  {
    operation: dismissSuggestedFixOp,
    label: "Dismiss a Suggested Fix",
    domain: "improvements",
    description:
      "Dismiss the Suggested Fix on an improvement with a reason. This never touches knowledge.",
  },
  {
    operation: acceptSuggestedFixOp,
    label: "Accept a Suggested Fix",
    domain: "improvements",
    // Registered only for a Teammate an admin trusted with both halves; every
    // other Teammate has no accept tool at all, which is what makes it say "a
    // colleague has to accept this" instead of trying and being refused.
    requires: (actor) =>
      mayAcceptSuggestedFix(actor, actor.grants.map((domain) => ({ domain }))),
    description:
      "Accept the Suggested Fix on an improvement, writing it into the organization's knowledge as a FAQ. Use this only when the draft is clearly correct.",
  },
];

const KNOWLEDGE: TeammateActionSpec[] = [
  {
    // Not a knowledge operation, and here anyway: `knowledge.collections.list`
    // and `knowledge.org.faqs.create` both take an Assistant id, and without
    // this the Teammate has a domain it cannot use, because it has no way to
    // learn one. A read at `member` capability, in the domain whose writes
    // need it, beats a fourth grantable domain nobody would understand.
    operation: listAssistantsOp,
    label: "List assistants",
    domain: "knowledge",
    description:
      "List this organization's assistants. Knowledge is linked to assistants, so most knowledge calls need one of these ids.",
  },
  {
    operation: listCollectionsOp,
    label: "List knowledge collections",
    domain: "knowledge",
    description: "List the Knowledge Collections in this organization's Library.",
  },
  {
    operation: listOrgKnowledgeSourcesOp,
    label: "List knowledge sources",
    domain: "knowledge",
    description:
      "List the Sources in the Library: websites, files and the FAQs behind the answers.",
  },
  {
    operation: listOrgFaqsOp,
    label: "List FAQs",
    domain: "knowledge",
    description: "List the organization's curated FAQ question-and-answer pairs.",
  },
  {
    operation: getOrgFaqOp,
    label: "Read a FAQ",
    domain: "knowledge",
    description: "Read one FAQ in full.",
  },
  {
    operation: createOrgFaqOp,
    label: "Add a FAQ",
    domain: "knowledge",
    description:
      "Add a FAQ to the Library, so the assistant can answer this question from now on.",
  },
  {
    operation: updateOrgFaqOp,
    label: "Correct a FAQ",
    domain: "knowledge",
    description: "Correct an existing FAQ's question or answer.",
  },
];

const INBOX: TeammateActionSpec[] = [
  {
    operation: listInboxConversationsOp,
    label: "List conversations",
    domain: "inbox",
    description:
      "List the conversations visitors had with this organization's assistants.",
  },
  {
    operation: getConversationOp,
    label: "Read a conversation",
    domain: "inbox",
    description:
      "Read one conversation: the full transcript, its sources and its escalation state.",
  },
  {
    operation: setConversationPinnedOp,
    label: "Pin a conversation",
    domain: "inbox",
    description: "Pin or unpin a conversation in the Inbox.",
  },
];

/**
 * The two writes a Teammate performs on its own memory (#771), kept apart from
 * the grant catalogue on purpose.
 *
 * A grant is an admin saying "this agent may act on our board, our knowledge,
 * our inbox". Remembering what a colleague told it, and writing down what the
 * team decided, is not that: it is the thing that makes it a colleague rather
 * than a search box, and gating it behind a row would leave every ungranted
 * Teammate re-asking the same question forever.
 *
 * The safety here is structural instead. Neither tool takes a target: the
 * profile is always the Member on the other end of this turn, and the Project
 * is always the one the Teammate is attached to. There is no input a prompt
 * injection could bend toward somebody else's document.
 */
const MEMORY: TeammateActionSpec[] = [
  {
    operation: rememberAboutMemberOp,
    label: "Update what you know about them",
    // Not a granted domain: these two are ungated, and the card says what the
    // write touched rather than inventing a grant.
    domain: "memory",
    description:
      "Rewrite your notes about the colleague you are talking to: their name, timezone, how they like to work. Pass the WHOLE document as it should now read, not just the new part. They can see and edit it in their settings, so write only what they would be comfortable reading back.",
  },
  {
    operation: recordProjectDecisionOp,
    label: "Record a project decision",
    domain: "memory",
    description:
      "Write down a decision or convention the team has settled, in the project's decisions document. Pass the WHOLE document as it should now read. Use this when something is decided, not for every passing opinion.",
  },
];

/**
 * The memory tools this Teammate can use. Both are ungated; the Project one
 * needs somewhere to write, so it appears only when the Teammate is attached
 * to a Project (offering it otherwise means it calls it and is told no).
 */
export function teammateMemoryActions(
  actor: TeammateActor
): TeammateActionSpec[] {
  return MEMORY.filter(
    (spec) =>
      spec.operation.name !== recordProjectDecisionOp.name ||
      Boolean(actor.projectId)
  );
}

export const TEAMMATE_ACTION_CATALOG: Record<
  TeammateGrantDomain,
  readonly TeammateActionSpec[]
> = {
  improvements: IMPROVEMENTS,
  knowledge: KNOWLEDGE,
  inbox: INBOX,
};

/**
 * The actions this Teammate may take, in catalogue order.
 *
 * Three filters, and they only ever narrow: the grant rows pick the domains,
 * the ceiling caps what may be reached inside them, and the per-action gate
 * handles approval-bypass. An empty result is the normal state of a Teammate
 * nobody granted anything, and it means the turn registers no action tools.
 */
export function teammateActions(actor: TeammateActor): TeammateActionSpec[] {
  const granted = new Set(actor.grants);
  return Object.entries(TEAMMATE_ACTION_CATALOG)
    .filter(([domain]) => granted.has(domain as TeammateGrantDomain))
    .flatMap(([, specs]) => specs)
    .filter(
      (spec) =>
        ceilingAllowsCapability(actor.ceiling, spec.operation.capability) &&
        (spec.requires?.(actor) ?? true)
    );
}

/**
 * What running one catalogued action produced.
 *
 * Named apart from the runtime's `TeammateActionOutcome` (the host port's
 * narrower view: entities plus result) because two exported interfaces with one
 * name and two shapes is a coin flip at every import.
 */
export interface TeammateActionRun {
  /** The operation's catalogue name, e.g. `improvements.update`. */
  operation: string;
  domain: TeammateActionDomain;
  /** What it mutated, as the operation itself declared. Empty for a read. */
  entities: MutatedEntity[];
  result: unknown;
}

/**
 * Run one catalogued action as the Teammate.
 *
 * The gate runs here as well as at registration time, and that repetition is
 * the point: registration decides what the model is *offered*, this decides
 * what actually executes, and a bug in the first must not become a capability.
 * A tool call naming something the Teammate was not granted is refused with a
 * sentence written for the model, not a stack trace.
 */
export async function runTeammateAction(
  ctx: OperationContext,
  operationName: string,
  rawInput: unknown
): Promise<TeammateActionRun> {
  const actor = ctx.teammate;
  if (!actor) {
    throw new OperationError(
      "invalid_input",
      "This operation ran without a Teammate to run as"
    );
  }
  const spec = [...teammateActions(actor), ...teammateMemoryActions(actor)].find(
    (candidate) => candidate.operation.name === operationName
  );
  if (!spec) {
    throw new OperationError("invalid_input", actionRefusal(domainOf(operationName)));
  }
  const input = spec.operation.input.parse(rawInput);
  const result = await spec.operation.run(ctx, input);
  return {
    operation: spec.operation.name,
    domain: spec.domain,
    entities: spec.operation.entities(input, result),
    result,
  };
}

/** `improvements.fix.accept` → `improvements`, for the refusal sentence. */
function domainOf(operationName: string): string {
  return operationName.split(".")[0] ?? operationName;
}
