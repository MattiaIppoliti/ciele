"use server";

import { roleAllowsCapability } from "@agent-hub/core";
import { listOrgApiKeysOp, listTeammatesOp } from "@ciele/ops";
import { requireMember } from "@/lib/authz";
import { runOperation } from "@/lib/operations";
import {
  defaultInsightsFilter,
  getInsightsOverviewCached,
} from "@/lib/insights/report";
import { cachedFindDetail, cachedFindPage, cachedFindRecords } from "@/lib/find-cache";
import {
  isFindKind,
  type FindDetailRequest,
  type FindPreviewData,
  type FindRecordsResult,
} from "@/lib/find-index";
import {
  readFindDetail,
  readFindRecords,
  readPageStats,
  type FindReadContext,
} from "@/lib/find-reads";
import { WARM_LIMIT } from "@/lib/find-store";

/**
 * The Find palette's server entry points: who is asking. What is read, and
 * how, is `lib/find-reads.ts`; how long an answer is reused is
 * `lib/find-cache.ts`.
 */

/** Everything an authorized read starts from. */
async function readContext(): Promise<FindReadContext> {
  const { db, session } = await requireMember();
  return {
    db,
    organizationId: session.organization.id,
    organizationName: session.organization.name,
    role: session.role ?? null,
    userId: session.userId,
    listTeammates: () => runOperation(listTeammatesOp, {}),
    // The operation declares who may list keys; asking it first keeps a
    // refused Member from reaching the capability check that redirects.
    listApiKeys: async () =>
      roleAllowsCapability(session.role ?? null, listOrgApiKeysOp.capability)
        ? runOperation(listOrgApiKeysOp, {})
        : null,
    insights: () =>
      getInsightsOverviewCached(session.organization.id, defaultInsightsFilter(new Date())),
  };
}

/** Ids and hrefs come from the client. Refuse anything that cannot be one before it becomes a cache key. */
const MAX_KEY_PART = 200;
const sane = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_KEY_PART;

/** The records behind the palette: the most recent of each kind, and whether every kind was read. */
export async function loadFindRecords(): Promise<FindRecordsResult> {
  const ctx = await readContext();
  return cachedFindRecords(ctx, () => readFindRecords(ctx));
}

/**
 * The detail of several rows in one call, by key: a record's extra, or a
 * console page's live numbers. One request instead of one per row, because
 * server actions from a page run one at a time, so a row's answer used to wait
 * behind every row asked before it.
 *
 * At most `WARM_LIMIT` rows, since the store never warms more. A row whose
 * read threw is left out of the answer, which the store reads as a failure
 * for that row alone; the rest still arrive.
 */
export async function loadFindDetails(
  requests: FindDetailRequest[]
): Promise<Record<string, FindPreviewData | null>> {
  if (!Array.isArray(requests)) return {};
  const valid = requests.slice(0, WARM_LIMIT).filter((r) => r && sane(r.key));
  if (valid.length === 0) return {};
  const ctx = await readContext();
  const out: Record<string, FindPreviewData | null> = {};
  await Promise.all(
    valid.map(async (request) => {
      try {
        if ("href" in request) {
          if (!sane(request.href)) return void (out[request.key] = null);
          out[request.key] = await cachedFindPage(ctx, request.href, () =>
            readPageStats(ctx, request.href)
          );
          return;
        }
        if (!isFindKind(request.kind) || !sane(request.id)) return void (out[request.key] = null);
        out[request.key] = await cachedFindDetail(ctx, request.kind, request.id, () =>
          readFindDetail(ctx, request.kind, request.id)
        );
      } catch (error) {
        console.error("[find] detail read failed", error);
      }
    })
  );
  return out;
}
