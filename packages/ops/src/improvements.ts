import { z } from "zod";
import type {
  Improvement,
  ImprovementProposal,
  ImprovementPatch,
  ImprovementStatus,
} from "@agent-hub/core";
import {
  AUTO_IMPROVEMENT_LABEL,
  findDuplicateImprovement,
  mayAcceptSuggestedFix,
  messageText,
  okfActor,
} from "@agent-hub/core";
import { writingActor } from "./actor";
import { findOpenImprovementForConversation } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import { OperationError, defineOperation } from "./operation";

/**
 * The Improvements domain (#625): the answer-quality kanban, readable by any
 * member-tier key and editable at `edit`, so external trackers can sync.
 * Creation stays web-only for now (it fans out into graph feedback and
 * Suggested-Fix drafting); this ships list / detail / update.
 */

async function requireImprovement(
  ctx: OperationContext,
  id: string
): Promise<Improvement> {
  const improvement = await ctx.db.getImprovement(id);
  if (!improvement || improvement.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Improvement not found");
  }
  return improvement;
}

export const improvementPatchSchema = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(10000),
    status: z.custom<Improvement["status"]>((v) => typeof v === "string"),
    priority: z.custom<Improvement["priority"]>(
      (v) => typeof v === "string" || v === null
    ),
    tags: z.array(z.string().max(100)).max(50),
    assigneeId: z.string().nullable(),
    dueDate: z.string().nullable(),
    projectId: z.string().nullable(),
  })
  .partial() satisfies z.ZodType<ImprovementPatch, ImprovementPatch>;

export const listImprovementsOp = defineOperation({
  name: "improvements.list",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listImprovements(ctx.organizationId),
});

export const getImprovementOp = defineOperation({
  name: "improvements.get",
  capability: "member",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { id }) => {
    const improvement = await requireImprovement(ctx, id);
    const [associations, proposal] = await Promise.all([
      ctx.db.listImprovementMessages(id),
      ctx.db.getImprovementProposal(id),
    ]);
    return { improvement, associations, proposal };
  },
});

export const updateImprovementOp = defineOperation({
  name: "improvements.update",
  capability: "edit",
  input: z.object({ id: z.string().min(1), patch: improvementPatchSchema }),
  entities: ({ id }) => [
    { kind: "improvementList" as const },
    { kind: "improvement" as const, id },
  ],
  run: async (ctx, { id, patch }) => {
    const before = await requireImprovement(ctx, id);
    const updated = await ctx.db.updateImprovement(id, patch);
    await ctx.ports?.notifyImprovementUpdate?.({ before, updated, patch });
    return updated;
  },
});


// ── Suggested Fixes (#770) ───────────────────────────────────────────────────
//
// A Suggested Fix used to have exactly one author, the background drafter
// (ADR-0017 / #390), and exactly one accepter, a Member clicking a button in
// the console. An AI Teammate with the improvements grant is a second author,
// and with approval-bypass a second accepter, so both halves move here where
// the rule can be stated once and both surfaces run it.
//
// The invariant the ADR amendment turns on: **who verified the Concept is
// recorded truthfully**. A Member accepting stamps `human:<id>`, which is what
// produces OKF's `human-reviewed` tier. A Teammate accepting its own draft
// stamps an agent actor, so the Concept comes out `machine-confirmed`. The
// bypass changes who may press accept; it does not let a machine sign as a
// person.

async function requireDraftProposal(
  ctx: OperationContext,
  improvementId: string
): Promise<ImprovementProposal> {
  const proposal = await ctx.db.getImprovementProposal(improvementId);
  if (!proposal || proposal.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "No Suggested Fix on this improvement");
  }
  if (proposal.status !== "draft") {
    throw new OperationError(
      "conflict",
      `This Suggested Fix was already ${proposal.status}`
    );
  }
  return proposal;
}

export const proposeSuggestedFixOp = defineOperation({
  name: "improvements.fix.propose",
  capability: "edit",
  input: z.object({
    improvementId: z.string().min(1),
    question: z.string().min(1).max(500),
    answer: z.string().min(1).max(4000),
    rationale: z.string().max(600).default(""),
  }),
  entities: ({ improvementId }) => [
    { kind: "improvement" as const, id: improvementId },
  ],
  run: async (ctx, input): Promise<ImprovementProposal> => {
    const improvement = await requireImprovement(ctx, input.improvementId);
    const existing = await ctx.db.getImprovementProposal(improvement.id);
    // One open draft per Improvement. Without this a Teammate asked twice
    // leaves two drafts and the reviewer has to guess which one the board item
    // means; re-drafting is a dismiss followed by a propose.
    if (existing && existing.status === "draft") {
      throw new OperationError(
        "conflict",
        "This improvement already has a Suggested Fix awaiting review"
      );
    }

    // Where accepting would write. A Suggested Fix becomes a FAQ Concept in the
    // knowledge the flagged answer came from, so the target is the flagged
    // conversation's Assistant, and an Improvement with nothing flagged has no
    // knowledge to fix.
    const associations = await ctx.db.listImprovementMessages(improvement.id);
    const flagged = associations.find((a) => a.conversation.assistantId);
    const targetAssistantId = flagged?.conversation.assistantId;
    if (!targetAssistantId) {
      throw new OperationError(
        "invalid_input",
        "This improvement has no flagged assistant answer, so there is no knowledge to fix"
      );
    }

    return ctx.db.createImprovementProposal({
      organizationId: ctx.organizationId,
      improvementId: improvement.id,
      payload: {
        draftQuestion: input.question,
        draftAnswer: input.answer,
        rationale: input.rationale,
        // Drafted from the conversation in front of it rather than from a
        // retrieval pass, so it claims no knowledge provenance it does not have.
        sources: [],
        model: ctx.teammate ? `teammate/${ctx.teammate.name}` : "member",
        targetAssistantId,
        targetCollectionId: flagged.conversation.collectionId ?? null,
      },
    });
  },
});

/** What accepting produced: the closed proposal, the Concept, and where it went. */
export interface AcceptedSuggestedFix {
  proposal: ImprovementProposal;
  conceptId: string;
  /** The Assistant whose Knowledge grew, so the caller can refresh that page. */
  assistantId: string;
}

export const acceptSuggestedFixOp = defineOperation<
  { improvementId: string },
  AcceptedSuggestedFix
>({
  name: "improvements.fix.accept",
  capability: "edit",
  input: z.object({ improvementId: z.string().min(1) }),
  entities: ({ improvementId }, result) => [
    { kind: "improvement" as const, id: improvementId },
    { kind: "improvementList" as const },
    { kind: "inbox" as const },
    // The new FAQ lands in the target Assistant's Knowledge, which is a page
    // away from the Improvement the reviewer was looking at.
    ...(result?.assistantId
      ? [{ kind: "assistantEditor" as const, assistantId: result.assistantId }]
      : []),
  ],
  run: async (ctx, { improvementId }): Promise<AcceptedSuggestedFix> => {
    // The ADR-0017 amendment, in one branch. A Member accepting reaches this
    // with no `teammate` on the context and passes. A Teammate needs both the
    // admin's bypass and the knowledge grant, because accepting *is* a
    // knowledge write.
    if (ctx.teammate) {
      const grants = ctx.teammate.grants.map((domain) => ({ domain }));
      if (!mayAcceptSuggestedFix(ctx.teammate, grants)) {
        throw new OperationError(
          "invalid_input",
          "You may draft a Suggested Fix but not accept it. Tell the person you are talking to that a colleague has to review and accept it in Improvements."
        );
      }
    }
    const proposal = await requireDraftProposal(ctx, improvementId);
    const { targetAssistantId, targetCollectionId } = proposal.payload;
    const collectionId =
      targetCollectionId ??
      (await ctx.db.listCollections(targetAssistantId))[0]?.id ??
      null;
    if (!collectionId) {
      throw new OperationError(
        "invalid_input",
        "The assistant has no Knowledge Collection to add the FAQ to"
      );
    }
    if (!ctx.ports?.persistFaq) {
      throw new OperationError(
        "invalid_input",
        "Knowledge writing is not wired on this deployment"
      );
    }

    // The drafter's provenance resolved to OKF v0.2 (§5.1): each Concept the
    // draft drew on becomes a bundle-relative `sources` entry, so the new FAQ
    // records its derivation. Concepts deleted since the draft are dropped
    // rather than left pointing nowhere.
    const draftedFrom = (
      await Promise.all(
        proposal.payload.sources.map(async (source) => {
          const cited = await ctx.db.getConcept(source.conceptId).catch(() => null);
          return cited
            ? {
                id: source.conceptId,
                resource: `/${cited.path}`,
                title: source.conceptTitle,
              }
            : null;
        })
      )
    ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const at = new Date().toISOString();
    const concept = await ctx.ports.persistFaq({
      assistantId: targetAssistantId,
      collectionId,
      question: proposal.payload.draftQuestion,
      answer: proposal.payload.draftAnswer,
      provenance: {
        generated: {
          by: okfActor.agent("suggested-fix-drafter", proposal.payload.model),
          at,
        },
        // Who signed off, truthfully. A person here is the one place the
        // platform produces `human-reviewed` (§5.3); a bypassing Teammate is an
        // agent actor, so its own accept comes out `machine-confirmed` and the
        // Knowledge page shows that tier rather than claiming a review nobody did.
        verified: [{ by: writingActor(ctx), at }],
        ...(draftedFrom.length > 0 ? { sources: draftedFrom } : {}),
      },
    });

    const accepted = await ctx.db.updateImprovementProposal(proposal.id, {
      status: "accepted",
      acceptedConceptId: concept.id,
    });
    await ctx.db.updateImprovement(improvementId, { status: "in_review" });
    return { proposal: accepted, conceptId: concept.id, assistantId: targetAssistantId };
  },
});

export const dismissSuggestedFixOp = defineOperation({
  name: "improvements.fix.dismiss",
  capability: "edit",
  input: z.object({
    improvementId: z.string().min(1),
    reason: z.string().max(1000).default(""),
  }),
  entities: ({ improvementId }) => [
    { kind: "improvement" as const, id: improvementId },
  ],
  run: async (ctx, { improvementId, reason }): Promise<ImprovementProposal> => {
    const existing = await ctx.db.getImprovementProposal(improvementId);
    // Dismissing twice is what a double-click looks like, and the second one
    // asks for a state the fix is already in. Accepting-then-dismissing is a
    // different thing entirely: the Concept is written, and pretending
    // otherwise would be the lie.
    if (existing?.status === "dismissed") return existing;
    const proposal = await requireDraftProposal(ctx, improvementId);
    // Knowledge is never touched on this path, which is what makes dismissing
    // safe to grant at the same capability as drafting.
    return ctx.db.updateImprovementProposal(proposal.id, {
      status: "dismissed",
      dismissReason: reason.trim().slice(0, 1000),
    });
  },
});


// ── Feedback triage (#772) ───────────────────────────────────────────────────
//
// The flagship Routine template, as an operation rather than as prose in a
// routine's instruction. Three reasons it is code: the dedup and the cap are
// invariants nobody should be able to talk a model out of, the label has to be
// exactly one string for the board filter to work, and a scheduled job that
// files Improvements every night is precisely the thing that must not be able
// to flood the board when it misbehaves.
//
// The model still decides *whether* to run it and reads the result; what it
// cannot do is file six, file duplicates, or forget the label.

/** How far back one run looks. A day of slack over a daily cadence. */
const TRIAGE_WINDOW_MS = 36 * 3_600_000;
/** The spec's cap (#767): five new items per run, however much it finds. */
const TRIAGE_CAP = 5;

export interface FeedbackTriageResult {
  /** Conversations with a thumbs-down inside the window. */
  scanned: number;
  /** New Improvements filed, never more than the cap. */
  filed: { id: string; seq: number; title: string }[];
  /** Flagged answers that already had an open Improvement on them. */
  deduped: number;
  /** Found but not filed because the cap was reached. */
  skippedForCap: number;
}

export const triageFeedbackOp = defineOperation({
  name: "improvements.triage_feedback",
  capability: "edit",
  input: z.object({}),
  entities: () => [{ kind: "improvementList" as const }, { kind: "inbox" as const }],
  run: async (ctx): Promise<FeedbackTriageResult> => {
    const since = new Date(Date.now() - TRIAGE_WINDOW_MS).toISOString();
    const conversations = await ctx.db.listInboxConversations(ctx.organizationId);
    const recent = conversations.filter(
      (conversation) =>
        conversation.feedback === -1 && conversation.updatedAt >= since
    );

    const result: FeedbackTriageResult = {
      scanned: recent.length,
      filed: [],
      deduped: 0,
      skippedForCap: 0,
    };

    /**
     * The board, for the cross-conversation half of the dedup (#767, story 15).
     *
     * Read once before the loop and appended to as items are filed, so two
     * conversations in the *same* run about one problem collapse the way two
     * runs a day apart already would.
     */
    const board: { id: string; title: string; status: ImprovementStatus }[] = (
      await ctx.db.listImprovements(ctx.organizationId)
    ).map((item) => ({ id: item.id, title: item.title, status: item.status }));

    for (const conversation of recent) {
      const messages = await ctx.db.listMessages(conversation.id);
      const flagged = messages.filter(
        (message) => message.role === "assistant" && message.feedback === -1
      );
      if (flagged.length === 0) continue;

      // Conversation-scoped dedup, the same walk every automatic producer
      // already shares: an open Improvement already linked here gains the
      // flagged answer as an occurrence rather than a clone.
      const open = await findOpenImprovementForConversation(ctx.db, conversation.id);
      if (open) {
        result.deduped += 1;
        for (const message of flagged) {
          await ctx.db.linkImprovementMessage(open.id, message.id);
        }
        continue;
      }

      const question = lastVisitorQuestion(messages, flagged[0].id);
      const title = triageTitle(question, conversation.title);

      // The other half: a different conversation restating a problem the board
      // already holds. Without this, one broken answer that ten visitors hit
      // files ten items, which is the flood story 15 is about.
      //
      // Skipped for the untitled fallback, which carries no information to
      // match on and would otherwise match everything it equals.
      const twin =
        title === UNTITLED_TRIAGE_TITLE
          ? null
          : findDuplicateImprovement(title, board);
      if (twin) {
        result.deduped += 1;
        for (const message of flagged) {
          await ctx.db.linkImprovementMessage(twin.id, message.id);
        }
        continue;
      }

      // The cap is checked *after* dedup, so a run that finds ten recurrences
      // of one known problem still attaches all ten: the cap is on new items,
      // which is what floods a board, not on evidence.
      if (result.filed.length >= TRIAGE_CAP) {
        result.skippedForCap += 1;
        continue;
      }

      const improvement = await ctx.db.createImprovement(ctx.organizationId, {
        title,
        // The invoking Member on an attended run; on an unattended one there
        // is nobody, and the field says so rather than naming the routine's
        // author as if they had filed it by hand.
        createdBy: ctx.userId || null,
        messageId: flagged[0].id,
      });
      for (const message of flagged.slice(1)) {
        await ctx.db.linkImprovementMessage(improvement.id, message.id);
      }
      // The dedicated label (#767, story 16), so a Member can filter the board
      // down to what the Teammate filed.
      await ctx.db.updateImprovement(improvement.id, {
        tags: [AUTO_IMPROVEMENT_LABEL],
      });
      board.push({
        id: improvement.id,
        title: improvement.title,
        status: improvement.status,
      });
      result.filed.push({
        id: improvement.id,
        seq: improvement.seq,
        title: improvement.title,
      });
    }
    return result;
  },
});

/** The visitor's question before the flagged answer: what the item is about. */
function lastVisitorQuestion(
  messages: { id: string; role: string; content: unknown[] }[],
  flaggedId: string
): string {
  const index = messages.findIndex((message) => message.id === flaggedId);
  const prior = [...messages.slice(0, index)]
    .reverse()
    .find((message) => message.role === "user");
  return messageText(prior?.content ?? [], " ").trim();
}

/**
 * The board row's title. The visitor's own words when there are any, because
 * "Bad answer in conversation 8f2c" tells a reviewer nothing about whether to
 * pick it up.
 */
function triageTitle(question: string, conversationTitle: string): string {
  const text = question || conversationTitle || UNTITLED_TRIAGE_TITLE;
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/**
 * The title used when a flagged conversation says nothing about itself: no
 * visitor question, no conversation title.
 *
 * Named because the dedup has to refuse it. It is the same string every time,
 * so cross-conversation matching would score it 1.0 against itself and pile
 * every unrelated untitled complaint onto whichever one came first, where
 * nobody would ever find them.
 */
const UNTITLED_TRIAGE_TITLE = "A visitor rated an answer down";
