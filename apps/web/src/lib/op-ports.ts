import type { Concept, ConceptFrontmatter } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { OperationPorts } from "@ciele/ops";
import {
  enqueueGraphSyncJob,
  enqueueIngestJob,
  persistConcept,
  restartWebsiteCrawl,
  sendEmail,
} from "@agent-hub/agent";
import { improvementAssignedEmail, improvementClosedEmail } from "@/lib/notify";
import { invalidatePublication } from "@/lib/widget-db";

/**
 * The one implementation of the operations layer's host ports (#621–#625),
 * shared by both surfaces: `lib/operations.ts` wires it over the session's
 * RLS-scoped Db, `lib/api-v1/run.ts` over the service-role Db. Operations
 * guard; these effect.
 */
export function webOperationPorts(
  db: Db,
  opts: {
    organizationId: string;
    actorEmail: string;
    /**
     * Server Actions keep the default `updateTag` path (read-your-own-writes);
     * Route Handlers must pass the `revalidateTag`-based variant — Next
     * forbids `updateTag` outside an action.
     */
    invalidatePublication?: (assistantId: string) => void;
  }
): OperationPorts {
  return {
    purgeCollectionGraph: (collectionId) =>
      enqueueGraphSyncJob({ op: "purge", collectionId }, { db }),
    removeConceptGraph: (collectionId, conceptId) =>
      enqueueGraphSyncJob({ op: "remove", collectionId, conceptId }, { db }),
    enqueueIngest: (job) =>
      enqueueIngestJob({ kind: "ingest_source", ...job }, { db }),
    persistFaq: (args) =>
      persistFaqConcept({
        db,
        organizationId: opts.organizationId,
        ...args,
      }),
    restartCrawl: async (sourceId) => {
      await restartWebsiteCrawl({ db, sourceId });
    },
    invalidatePublication: (assistantId) =>
      (opts.invalidatePublication ?? invalidatePublication)(assistantId),
    notifyImprovementUpdate: async ({ before, updated, patch }) => {
      const key = `IMP-${updated.seq}`;
      const members = await db.listMembers(opts.organizationId);
      const emailOf = (userId: string | null) =>
        userId
          ? (members.find((m) => m.userId === userId)?.email ?? null)
          : null;

      if (
        patch.assigneeId !== undefined &&
        patch.assigneeId !== before.assigneeId &&
        updated.assigneeId
      ) {
        const to = emailOf(updated.assigneeId);
        if (to)
          await sendEmail(
            improvementAssignedEmail({
              to,
              key,
              title: updated.title,
              actorEmail: opts.actorEmail,
            })
          );
      }

      if (patch.status === "done" && before.status !== "done") {
        const to = emailOf(updated.createdBy);
        if (to)
          await sendEmail(
            improvementClosedEmail({
              to,
              key,
              title: updated.title,
              actorEmail: opts.actorEmail,
            })
          );
      }
    },
  };
}

/**
 * One FAQ = one OKF Concept at `faq/<slug>.md` (moved here from actions.ts
 * so both the ports factory and the Suggested-Fix acceptance path share it).
 */
export async function persistFaqConcept(args: {
  db: Db;
  organizationId: string;
  assistantId: string;
  collectionId: string;
  question: string;
  answer: string;
  /**
   * OKF v0.2 trust + provenance for the Concept this writes (§5.1/§5.2) — who
   * authored it, who confirmed it, what it derives from. Required rather than
   * defaulted: callers differ exactly here (a person typing a FAQ is `human:`
   * generated; an accepted Suggested Fix is agent-generated and
   * human-*verified*), and silently defaulting would misattribute one.
   */
  provenance: Pick<ConceptFrontmatter, "generated" | "verified" | "sources">;
  /** Disambiguates bundle paths in bulk imports (e.g. "-3"). */
  pathSuffix?: string;
}): Promise<Concept> {
  const question = args.question.trim();
  const slug =
    (question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "faq") + (args.pathSuffix ?? "");
  const connections = await args.db.listProviderConnections(args.organizationId);
  return persistConcept({
    db: args.db,
    assistantId: args.assistantId,
    collectionId: args.collectionId,
    sourceId: null,
    path: `faq/${slug}.md`,
    frontmatter: {
      type: "FAQ",
      title: question,
      description: args.answer.slice(0, 140),
      ...args.provenance,
    },
    body: args.answer,
    connections,
  });
}
