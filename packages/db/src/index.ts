import type { SupabaseClient } from "@supabase/supabase-js";
import { mockDb } from "./mock";
import { createSupabaseDb } from "./supabase";
import type { Db } from "./types";

export * from "./types";
export type {
  DbTableAccessor,
  DbTableInsert,
  DbTableListOptions,
  DbTableMap,
  DbTableName,
  DbTableRow,
  DbTableUpdate,
} from "./table-access";
export {
  DEFAULT_AI_DISCLAIMER,
  DEFAULT_FLOWS,
  DEFAULT_WELCOME_MESSAGE,
  WEEK_DAYS,
  defaultChannelAvailability,
  defaultChannelConversationData,
  defaultTimeRange,
  normalizeChannelAvailability,
  sortFlows,
} from "./defaults";
export { matchFlow, messageFlowCandidates } from "./engine";
export type {
  OkfActorStamp,
  OkfAttester,
  OkfExecutor,
  OkfParameter,
  OkfSource,
  OkfStatus,
  OkfTrustTier,
  OkfUsageWindow,
} from "./okf";
export {
  OKF_VERSION,
  conceptGeneratedAt,
  conceptStatus,
  isHumanActor,
  isStale,
  lastVerifiedAt,
  okfActor,
  trustTier,
  verificationEvents,
} from "./okf";
export { buildPublicationConfig } from "./publication";
export { messageText } from "./message";
export { IMPROVEMENT_TITLE_MAX, raiseImprovement } from "./improvements";
export { effectivePageSchedule, nextCrawlDue } from "./recrawl";
export { hostOf, isoDay } from "./insights";
export { shortId } from "./id";
export { DEMO_MEMBER, DEMO_ORG } from "./mock";

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Supabase-backed Db bound to the caller's auth context. Build a fresh one
 * per request with a cookie-scoped client — RLS enforces tenant isolation.
 */
export function createDb(client: SupabaseClient): Db {
  return createSupabaseDb(client);
}

/**
 * In-memory demo Db (single demo org, seeded data). Used when Supabase env
 * vars are missing so the app works out of the box.
 */
export function getMockDb(): Db {
  return mockDb;
}
