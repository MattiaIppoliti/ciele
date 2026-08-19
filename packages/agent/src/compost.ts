import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Db } from "@agent-hub/db";
import {
  findOpenImprovementForConversation,
  raiseImprovement,
} from "@agent-hub/db";
import type {
  AiCredentialKind,
  CompostDigest,
  DueCompostAssistant,
  Provider,
} from "@agent-hub/core";

import { resolveChatModel } from "./models";
import { meterUsage, usageTotals } from "./usage";

/**
 * The compost loop (spec: weekly exhaust into proposed Improvements).
 * Failures become proposals, three max, human signature required: each
 * proposal lands as a tagged Improvement the admin accepts by working or
 * rejects by archiving. The loop's only writes are Improvements and its own
 * run records, nothing is ever auto-applied, by construction.
 */

export const COMPOST_PROPOSAL_TAG = "AI proposal";
const WINDOW_MS = 7 * 24 * 3_600_000;

// No .max(3) on the array: an over-eager model returning 4 proposals must
// degrade to the best 3 (sliced below), never to a validation error → 0.
const PROPOSALS_SCHEMA = z.object({
  proposals: z.array(
    z.object({
      kind: z.enum(["faq", "flow_adjustment", "answering_style", "standing_goal"]),
      title: z.string().max(120),
      rationale: z.string().max(600),
      draft: z.string().max(4_000),
    })
  ),
});

const COMPOST_SYSTEM = [
  "You are a quality analyst for an AI assistant embedded on an organization's website. You receive one week of failure exhaust: answers that failed independent verification, answers visitors rated down, escalations, refusals, standing-goal violations and demoted flows.",
  "Propose AT MOST 3 concrete improvements a human admin could accept: a new FAQ (draft = the question and a grounded answer), a flow adjustment (draft = a prose description of the matcher/action change), an answering-style amendment (draft = the paragraph to add), or a new standing goal (draft = the golden question plus its checkable expectations).",
  "Ground every proposal in the exhaust, cite what recurred. Fewer, sharper proposals beat filler; propose nothing you cannot justify from the data. Use the organization's own domain language from the excerpts.",
].join(" ");

function digestIsEmpty(digest: CompostDigest): boolean {
  return (
    digest.failedVerdicts.length === 0 &&
    digest.thumbsDown.length === 0 &&
    digest.escalatedConversations === 0 &&
    digest.refusals === 0 &&
    digest.goalViolations.length === 0 &&
    digest.demotedFlows.length === 0
  );
}

/** Compact, bounded text rendering of the week's exhaust for the model. */
export function renderDigest(digest: CompostDigest): string {
  const lines: string[] = [];
  if (digest.failedVerdicts.length > 0) {
    lines.push(`Failed verifications (${digest.failedVerdicts.length}):`);
    for (const v of digest.failedVerdicts.slice(0, 10)) {
      lines.push(`- ${v.reason}`);
    }
  }
  if (digest.thumbsDown.length > 0) {
    lines.push(`Thumbs-down answers (${digest.thumbsDown.length}):`);
    for (const t of digest.thumbsDown.slice(0, 5)) {
      lines.push(`- "${t.text.slice(0, 200)}"`);
    }
  }
  if (digest.escalatedConversations > 0) {
    lines.push(`Escalated conversations: ${digest.escalatedConversations}`);
  }
  if (digest.refusals > 0) lines.push(`Safety refusals: ${digest.refusals}`);
  if (digest.goalViolations.length > 0) {
    lines.push("Standing-goal violations:");
    for (const g of digest.goalViolations.slice(0, 5)) {
      lines.push(`- "${g.question}", ${g.detail}`);
    }
  }
  if (digest.demotedFlows.length > 0) {
    lines.push("Flows demoted to watch:");
    for (const f of digest.demotedFlows) {
      lines.push(`- flow ${f.flowId}: ${f.passes}/${f.runs} passing`);
    }
  }
  return lines.join("\n");
}

export interface CompostResult {
  /** Assistants processed this tick. */
  processed: number;
  /** Improvements created or incremented across them. */
  proposals: number;
  /** Assistants with a verified-clean week. */
  clean: number;
}

export async function runCompostPass(
  deps: { db: Db },
  options: {
    limit?: number;
    /** Test seam: overrides the resolved proposal model. */
    model?: LanguageModel;
  } = {}
): Promise<CompostResult> {
  const { db } = deps;
  // Weekly cadence with slack (6.5 days) so a drifting daily tick never
  // skips a week.
  const dueBefore = new Date(Date.now() - 6.5 * 24 * 3_600_000).toISOString();
  // Claim at window start: a second tick in the same window sees the assistant
  // as not-due before any digest or model call. A crashed claim expires with
  // the cadence window (the same 6.5-day cutoff), so it retries next window.
  const due = await db.claimDueCompostAssistants({
    dueBefore,
    staleBefore: dueBefore,
    limit: options.limit ?? 5,
  });

  const result: CompostResult = { processed: 0, proposals: 0, clean: 0 };
  for (const entry of due) {
    try {
      const outcome = await compostOne(db, entry, options.model);
      result.processed += 1;
      result.proposals += outcome.proposals;
      if (outcome.clean) result.clean += 1;
    } catch (error) {
      console.error("[compost] assistant pass failed:", error);
    }
  }
  return result;
}

async function compostOne(
  db: Db,
  entry: DueCompostAssistant,
  modelOverride?: LanguageModel
): Promise<{ proposals: number; clean: boolean }> {
  const windowEnd = new Date().toISOString();
  const windowStart =
    entry.lastRunAt ?? new Date(Date.now() - WINDOW_MS).toISOString();
  const digest = await db.getCompostDigest(entry.assistantId, windowStart);

  if (digestIsEmpty(digest)) {
    // A clean week is a record, not silence.
    await db.recordCompostRun({
      assistantId: entry.assistantId,
      organizationId: entry.organizationId,
      windowStart,
      windowEnd,
      proposals: 0,
      clean: true,
    });
    return { proposals: 0, clean: true };
  }

  let proposals: z.infer<typeof PROPOSALS_SCHEMA>["proposals"] = [];
  let model = modelOverride ?? null;
  let provider: Provider = "anthropic";
  let modelId = "test-model";
  let credentialKind: AiCredentialKind | null = null;
  if (!model) {
    const assistant = await db.getAssistant(entry.assistantId);
    const connections = await db.listProviderConnections(entry.organizationId);
    const resolved = assistant
      ? resolveChatModel(assistant.modelProvider, assistant.modelId, connections)
      : null;
    if (resolved) {
      model = resolved.model;
      provider = resolved.provider;
      modelId = resolved.modelId;
      credentialKind = resolved.credentialKind;
    }
  }
  if (model) {
    try {
      const { object, usage } = await generateObject({
        model,
        schema: PROPOSALS_SCHEMA,
        system: COMPOST_SYSTEM,
        prompt: `Exhaust for the past week:\n\n${renderDigest(digest)}`,
      });
      proposals = object.proposals.slice(0, 3);
      await meterUsage(db, [
        {
          organizationId: entry.organizationId,
          assistantId: entry.assistantId,
          stage: "compost",
          provider,
          modelId,
          credentialKind,
          ...usageTotals(usage),
        },
      ]);
    } catch (error) {
      // Malformed or failed generation degrades to zero proposals, the run
      // record still lands so the window doesn't re-run tomorrow.
      console.error("[compost] proposal generation failed:", error);
      proposals = [];
    }
  }

  const evidence = [
    ...digest.failedVerdicts.map((v) => ({
      messageId: v.messageId,
      conversationId: v.conversationId,
    })),
    ...digest.thumbsDown.map((t) => ({
      messageId: t.messageId,
      conversationId: t.conversationId,
    })),
  ];

  let created = 0;
  for (const proposal of proposals) {
    try {
      created += await landProposal(db, entry, proposal, evidence);
    } catch (error) {
      console.error("[compost] proposal landing failed:", error);
    }
  }

  await db.recordCompostRun({
    assistantId: entry.assistantId,
    organizationId: entry.organizationId,
    windowStart,
    windowEnd,
    proposals: created,
    clean: false,
  });
  return { proposals: created, clean: false };
}

/**
 * Lands one proposal in the kanban: attach to an open Improvement already
 * linked to an evidence conversation (occurrence, not clone) or create a
 * tagged item with rationale + draft and the evidence associations.
 */
async function landProposal(
  db: Db,
  entry: DueCompostAssistant,
  proposal: { kind: string; title: string; rationale: string; draft: string },
  evidence: { messageId: string; conversationId: string }[]
): Promise<number> {
  const conversations = [...new Set(evidence.map((e) => e.conversationId))].filter(
    Boolean
  );
  for (const conversationId of conversations) {
    // The shared dedup walk (packages/db improvements.ts): any open item
    // sharing the evidence counts, including ones the verifier created, so
    // known problems gain occurrences, not clones. Same problem already
    // proposed and still open: append the new evidence instead of cloning
    // the proposal.
    const improvement = await findOpenImprovementForConversation(
      db,
      conversationId
    );
    if (improvement) {
      for (const e of evidence.slice(0, 5)) {
        if (e.conversationId === conversationId) continue;
        await db.linkImprovementMessage(improvement.id, e.messageId).catch(() => {});
      }
      return 0;
    }
  }

  const improvement = await raiseImprovement(db, entry.organizationId, {
    title: `[${proposal.kind.replace("_", " ")}] ${proposal.title}`,
    messageId: evidence[0]?.messageId ?? null,
  });
  await db.updateImprovement(improvement.id, {
    description: `${proposal.rationale}\n\n---\n\nProposed draft:\n\n${proposal.draft}`,
    tags: [COMPOST_PROPOSAL_TAG],
  });
  for (const e of evidence.slice(1, 6)) {
    await db.linkImprovementMessage(improvement.id, e.messageId).catch(() => {});
  }
  return 1;
}
