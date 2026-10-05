import { computeUsageDashboard, type DashboardFacts, type UsageDashboardFilter } from "@agent-hub/core";

/** Local presentation data; no organization records or dashboard requests are used. */
export const BLOCK_FILTER: UsageDashboardFilter = { from: "2026-09-01", to: "2026-09-21", surface: "", assistantId: "" };
const days = Array.from({ length: 21 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);
const facts: DashboardFacts = {
  usage: days.flatMap((day, index) => [
    { day, surface: "widget", stage: "generate", provider: "google", modelId: "gemini-3.5-flash", assistantId: "catalog", calls: 40 + index, inputTokens: 24000 + index * 1200, outputTokens: 7000 + index * 400 },
    { day, surface: "teammate", stage: "generate", provider: "anthropic", modelId: "claude-sonnet-4-6", assistantId: null, calls: 12 + index, inputTokens: 18000 + index * 800, outputTokens: 5000 + index * 200 },
    { day, surface: "ingestion", stage: "embed", provider: "google", modelId: "gemini-embedding-001", assistantId: null, calls: 6 + index, inputTokens: 9000 + index * 600, outputTokens: 0 },
  ]),
  turns: days.flatMap((day, index) => [
    { day, surface: "widget", assistantId: "catalog", status: "succeeded", flowName: "Search knowledge", errorClass: null, latencyBucket: 5 + index % 3, turns: 35 + index, durationMs: (35 + index) * 2500, toolCalls: (35 + index) * 2 },
    { day, surface: "widget", assistantId: "catalog", status: "succeeded", flowName: "Basic Interaction", errorClass: null, latencyBucket: 2, turns: 12 + index % 5, durationMs: (12 + index % 5) * 800, toolCalls: 0 },
    { day, surface: "widget", assistantId: "catalog", status: "failed", flowName: "Search knowledge", errorClass: "provider_timeout", latencyBucket: 10, turns: 1 + index % 2, durationMs: (1 + index % 2) * 15000, toolCalls: 1 },
  ]),
  verdicts: days.flatMap((day, index) => [
    { day, assistantId: "catalog", verdict: "pass", count: 30 + index },
    { day, assistantId: "catalog", verdict: "fail", count: 2 + index % 3 },
  ]),
  conversations: days.flatMap((day, index) => [
    { day, assistantId: "catalog", escalated: false, conversations: 20 + index },
    { day, assistantId: "catalog", escalated: true, conversations: 2 + index % 3 },
  ]),
};
export const BLOCK_DASHBOARD = computeUsageDashboard(facts, BLOCK_FILTER);
export const EMPTY_BLOCK_DASHBOARD = computeUsageDashboard({ usage: [], turns: [], verdicts: [], conversations: [] }, BLOCK_FILTER);
export const BLOCK_PREVIOUS = { ...BLOCK_DASHBOARD.totals, spendEur: BLOCK_DASHBOARD.totals.spendEur * 1.12, turns: 960, successRate: 0.95, evalPassRate: 0.88, autonomyRate: 0.86, latencyP50Ms: 3200, latencyP95Ms: 11000 };
