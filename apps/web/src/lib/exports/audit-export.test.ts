import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import { renderExportArtifact } from "./artifacts";
vi.mock("@agent-hub/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@agent-hub/db")>();
  return { ...actual, createDb: () => actual.getMockDb() };
});
afterEach(() => vi.useRealTimers());
it("exports the filtered audit snapshot across equal-time page boundaries", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
  const db = getMockDb();
  const prefix = `export-${Date.now()}`;
  for (let index = 0; index < 1001; index++) await db.recordAuditEntry({
    organizationId: DEMO_ORG.id, operation: `${prefix}.update`, effect: "write", entities: [],
    memberId: null, memberName: "=unsafe()", memberEmail: null, apiKeyId: null, teammateId: null,
    agentAuthor: null, surface: "console", outcome: "ok",
  });
  await db.recordAuditEntry({ organizationId: DEMO_ORG.id, operation: "other.update", effect: "write", entities: [], memberId: null, memberName: null, memberEmail: null, apiKeyId: null, teammateId: null, agentAuthor: null, surface: "console", outcome: "ok" });
  const job = await db.createExportJob(DEMO_ORG.id, { kind: "audit_log", format: "csv", params: { domain: prefix, to: new Date().toISOString() } });
  // Audit exports use the Db adapter, so the unrelated Supabase transport is unused.
  const artifact = await renderExportArtifact({} as SupabaseClient, job);
  expect(artifact.format).toBe("csv");
  expect(typeof artifact.body).toBe("string");
  expect(String(artifact.body).split("\n")).toHaveLength(1002);
  expect(String(artifact.body)).not.toContain("other.update");
  expect(String(artifact.body)).toContain("'=unsafe()");
});
