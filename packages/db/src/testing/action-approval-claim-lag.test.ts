import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "../types";
import { createSupabaseDb } from "../supabase";
import { createPgliteSupabaseClient } from "./postgrest-shim";
import { createSchemaLoadedPglite } from "./supabase-contract-harness";

/**
 * The deploy serves against a database one migration behind (supabase/CLAUDE.md).
 * `20260930120000_action_approval_run_claim` added `run_claimed_at`, and the run
 * claim writes it. Without a fallback every approved action would fail for the
 * whole window between the deploy going live and the migrate job landing,
 * where before this change it ran.
 *
 * So this boots the chain stopped before that migration and drives the real
 * adapter. One migration behind, the claim has no lease to take: it answers the
 * approved, unrun row as it did before, and a failed run has no claim to
 * release. The decision's own compare-and-set still decides who runs it.
 */

let pg: PGlite;
let db: Db;
let organizationId: string;

beforeAll(async () => {
  pg = await createSchemaLoadedPglite({
    stopBefore: "20260930120000_action_approval_run_claim.sql",
  });
  const userId = randomUUID();
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')`,
    [userId, "owner@approval-lag.test"]
  );
  await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  db = createSupabaseDb(
    createPgliteSupabaseClient(pg, { id: userId, email: "owner@approval-lag.test" })
  );
  organizationId = await db.createOrganization("Lagging Org");
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

async function approved(status: "approved" | "pending" = "approved") {
  const assistant = await db.createAssistant(organizationId, { title: "Gate" });
  const conversation = await db.createConversation({
    assistantId: assistant.id,
    subjectType: "visitor",
    subjectId: `visitor-${randomUUID()}`,
    title: "Delete it",
  });
  const approval = await db.table("actionApprovals").insert({
    organizationId,
    conversationId: conversation.id,
    teammateId: null,
    requestedBy: null,
    operation: "assistants.delete",
    input: {},
    label: "Delete assistant",
    reversibility: "irreversible",
    reason: "irreversible",
    backend: null,
    calibrated: null,
    confidence: {},
    mapVersion: 1,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  if (status === "approved") {
    await db.decideActionApproval(approval.id, {
      status: "approved",
      decidedBy: null,
      decidedByName: "Ann",
      decidedAt: new Date().toISOString(),
    });
  }
  return approval;
}

const claim = { now: "2026-09-30T10:00:00.000Z", staleBefore: "2026-09-30T09:45:00.000Z" };

describe("against a schema without run_claimed_at", () => {
  it("still lets an approved action run, fail, run again, and be stamped", async () => {
    const approval = await approved();
    expect(await db.claimActionApprovalRun(approval.id, claim)).toMatchObject({
      id: approval.id,
      status: "approved",
    });
    await db.settleActionApprovalRun(approval.id, "failed", claim.now);
    expect(await db.claimActionApprovalRun(approval.id, claim)).not.toBeNull();
    await db.settleActionApprovalRun(approval.id, "ran", claim.now);
    expect(await db.claimActionApprovalRun(approval.id, claim)).toBeNull();
  });

  it("still refuses a row nobody approved", async () => {
    const pending = await approved("pending");
    expect(await db.claimActionApprovalRun(pending.id, claim)).toBeNull();
  });
});
