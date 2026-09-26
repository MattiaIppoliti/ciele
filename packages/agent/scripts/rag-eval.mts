/**
 * The retrieval bench behind ADR-0025: verbatim chunks, then 20 dense
 * candidates reranked to 6. On demand and never in CI, because it needs the
 * network and a platform key.
 *
 *   pnpm --filter @agent-hub/agent bench:rag [--json <file>]
 *
 * What it runs is production code, not a copy: each reading becomes Concepts
 * through `sourceConceptDrafts`, chunks through `chunkMarkdown`, and the
 * rerank is `createReranker` with its real timeout and fail-open. A search the
 * reranker could not serve is counted, and any such fallback fails the run,
 * because a bench that silently measured the hybrid order would report the
 * wrong stage.
 *
 * The one deliberate difference from production: candidates are the top 20 by
 * cosine over an in-memory index, not `db.searchChunks`, whose per-Source cap
 * and lexical top-up this bench does not reproduce (see ADR-0025).
 *
 * Two question sets, both judged by a model that labels each retrieved passage:
 *  - easy (50): one answer, one supporting paragraph. recall@k = a supporting
 *    passage is in the top k.
 *  - hard (50): indirect, multi-hop and cross-document, half in Italian.
 *    complete@k = the top k together state every required fact.
 *
 * Acceptance: easy recall@1 >= 95% and hard complete@6 >= 90% for the rerank
 * variant; the process exits 1 otherwise. Embeddings and judge verdicts are
 * cached in `scripts/rag-eval/.cache/`, so a re-run pays only for the rerank
 * calls (about 100, a few cents at most).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGateway, embedMany, generateText } from "ai";
import type { KnowledgeSearchResult, Source } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { chunkMarkdown, sourceConceptDrafts } from "../src/ingest";
import { KNOWLEDGE_SEARCH_LIMIT } from "../src/retrieval";
import {
  RERANK_CANDIDATES,
  RERANK_MODEL,
  createReranker,
  platformRerankingModel,
} from "../src/rerank";

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), "rag-eval");
const CACHE = path.join(HERE, ".cache");
const EMBEDDING_MODEL = "openai/text-embedding-3-small";
/** The judge the original bench used, kept so the numbers stay comparable. */
const JUDGE_MODEL = "anthropic/claude-haiku-4.5";
const EASY_RECALL_AT_1 = 0.95;
const HARD_COMPLETE_AT_6 = 0.9;

interface EasyQuestion {
  doc: string;
  lang: string;
  question: string;
  answer: string;
  evidence: string;
}
interface HardQuestion {
  kind: "indirect" | "multihop" | "crossdoc";
  lang: string;
  docs: string[];
  question: string;
  answer: string;
  facts: Array<{ fact: string; evidence: string }>;
}
interface Chunk {
  id: string;
  doc: string;
  text: string;
}

const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey || !platformRerankingModel()) {
  console.error("AI_GATEWAY_API_KEY is not set: the bench measures the platform reranker and refuses to run without it.");
  process.exit(2);
}
const gateway = createGateway({ apiKey });
mkdirSync(CACHE, { recursive: true });

function cached<T>(kind: string, key: unknown, compute: () => Promise<T>): Promise<T> {
  const file = path.join(
    CACHE,
    `${kind}-${createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 32)}.json`
  );
  if (existsSync(file)) return Promise.resolve(JSON.parse(readFileSync(file, "utf8")) as T);
  return compute().then((value) => {
    writeFileSync(file, JSON.stringify(value));
    return value;
  });
}

// ── Index: the production chunker over the readings ──────────────────────────
const chunks: Chunk[] = readdirSync(path.join(HERE, "corpus"))
  .filter((file) => file.endsWith(".txt"))
  .sort()
  .flatMap((file) => {
    const doc = file.replace(/\.txt$/, "");
    const text = readFileSync(path.join(HERE, "corpus", file), "utf8");
    const source = { id: doc, name: doc, kind: "file", config: {}, originalObjectPath: null } as unknown as Source;
    return sourceConceptDrafts(source, text)
      .flatMap((draft) => chunkMarkdown(draft.body))
      .map((chunk, i) => ({ id: `${doc}#v${i}`, doc, text: chunk }));
  });

async function embedAll(values: string[]): Promise<number[][]> {
  return cached("emb", [EMBEDDING_MODEL, values], async () => {
    const { embeddings } = await embedMany({
      model: gateway.embeddingModel(EMBEDDING_MODEL),
      values,
    });
    return embeddings;
  });
}

const unit = (v: number[]) => {
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
};
const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

const chunkVectors = (await embedAll(chunks.map((c) => c.text))).map(unit);

function denseTop(queryVector: number[], n: number): Chunk[] {
  return chunks
    .map((chunk, i) => ({ chunk, score: dot(queryVector, chunkVectors[i]!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((row) => row.chunk);
}

const asHit = (chunk: Chunk, rank: number): KnowledgeSearchResult => ({
  conceptId: chunk.id,
  conceptTitle: chunk.doc,
  conceptPath: `${chunk.doc}.md`,
  collectionId: "bench",
  collectionName: "bench",
  sourceName: chunk.doc,
  sourceId: chunk.doc,
  resourceUrl: null,
  content: chunk.text,
  similarity: 1 - rank / 100,
});

// A Db that records whether a rerank was metered: a metered call is a served
// one, and anything else was a fail-open.
let served = 0;
const benchDb = {
  recordAiUsage: async () => {
    served += 1;
  },
  raiseAlert: async () => {},
  resolveAlertsByKey: async () => {},
} as unknown as Db;
const reranker = createReranker({
  attribution: { db: benchDb, organizationId: "bench", assistantId: null, conversationId: null },
});

type Variant = "dense" | "rerank";
async function retrieve(variant: Variant, question: string, vector: number[]): Promise<Chunk[]> {
  if (variant === "dense") return denseTop(vector, KNOWLEDGE_SEARCH_LIMIT);
  const candidates = denseTop(vector, RERANK_CANDIDATES);
  const hits = await reranker(question, candidates.map(asHit), KNOWLEDGE_SEARCH_LIMIT);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return hits.map((hit) => byId.get(hit.conceptId)!);
}

// ── Judge ────────────────────────────────────────────────────────────────────
const passages = (texts: string[]) =>
  texts.map((t, i) => `\n<passage ${i + 1}>\n${t}\n</passage ${i + 1}>`).join("\n");

async function judgeText(prompt: string): Promise<string> {
  return cached("judge", [JUDGE_MODEL, prompt], async () => {
    const { text } = await generateText({
      model: gateway.languageModel(JUDGE_MODEL),
      prompt,
      temperature: 0,
      maxOutputTokens: 900,
    });
    return text;
  });
}

async function judgeEasy(q: EasyQuestion, texts: string[]): Promise<string[]> {
  const prompt = `Question: ${q.question}
Reference answer: ${q.answer}

Below are ${texts.length} passages retrieved for this question. For EACH passage decide:
- "supports": the passage alone contains the information needed to give the reference answer
- "contradicts": the passage states something about this that conflicts with the reference answer
- "absent": neither
${passages(texts)}
Return JSON: {"labels": ["supports|contradicts|absent", ... one per passage, in order]}`;
  const raw = await judgeText(prompt);
  const labels = [...(raw.match(/"labels"\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "").matchAll(/"(supports|contradicts|absent)"/g)].map((m) => m[1]!);
  if (labels.length !== texts.length) throw new Error(`judge returned ${labels.length} labels: ${raw.slice(0, 200)}`);
  return labels;
}

async function judgeHard(q: HardQuestion, texts: string[]): Promise<number[][]> {
  const facts = q.facts.map((f, i) => `${i + 1}. ${f.fact}`).join("\n");
  const prompt = `Question: ${q.question}
Required facts (ALL are needed to answer):
${facts}

Below are ${texts.length} retrieved passages. For EACH passage list the numbers of the required facts it states (possibly none), and whether it contradicts any of them.
${passages(texts)}
Return JSON: {"passages": [{"facts": [numbers], "contradicts": false}, ... one per passage, in order]}`;
  const raw = await judgeText(prompt);
  const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as {
    passages?: Array<{ facts?: unknown[] }>;
  };
  const rows = parsed.passages ?? [];
  if (rows.length !== texts.length) throw new Error(`judge returned ${rows.length} rows: ${raw.slice(0, 200)}`);
  return rows.map((row) => (row.facts ?? []).map(Number).filter(Number.isInteger));
}

// ── Run ──────────────────────────────────────────────────────────────────────
const easy = JSON.parse(readFileSync(path.join(HERE, "questions-easy.json"), "utf8")) as EasyQuestion[];
const hard = JSON.parse(readFileSync(path.join(HERE, "questions-hard.json"), "utf8")) as HardQuestion[];
const easyVectors = (await embedAll(easy.map((q) => q.question))).map(unit);
const hardVectors = (await embedAll(hard.map((q) => q.question))).map(unit);

/** Rank (1-based) at which the set is satisfied, or null. */
type Ranked = Array<number | null>;
const rate = (ranks: Ranked, k: number) => ranks.filter((r) => r !== null && r <= k).length / ranks.length;
const mrr = (ranks: Ranked) => ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / ranks.length;

const report: Record<string, unknown> = { model: RERANK_MODEL, candidates: RERANK_CANDIDATES, chunks: chunks.length };
const per: Record<string, unknown> = {};
let fallbacks = 0;

for (const variant of ["dense", "rerank"] as const) {
  const easyRanks: Ranked = [];
  for (const [i, q] of easy.entries()) {
    const before = served;
    const top = await retrieve(variant, q.question, easyVectors[i]!);
    if (variant === "rerank" && served === before) fallbacks += 1;
    const labels = await judgeEasy(q, top.map((c) => c.text));
    const first = labels.indexOf("supports");
    easyRanks.push(first < 0 ? null : first + 1);
  }
  const hardRanks: Ranked = [];
  for (const [i, q] of hard.entries()) {
    const before = served;
    const top = await retrieve(variant, q.question, hardVectors[i]!);
    if (variant === "rerank" && served === before) fallbacks += 1;
    const labels = await judgeHard(q, top.map((c) => c.text));
    const need = new Set(q.facts.map((_, n) => n + 1));
    const got = new Set<number>();
    let done: number | null = null;
    for (const [rank, facts] of labels.entries()) {
      for (const f of facts) got.add(f);
      if (done === null && [...need].every((n) => got.has(n))) done = rank + 1;
    }
    hardRanks.push(done);
  }
  report[variant] = {
    easy: { "recall@1": rate(easyRanks, 1), "recall@3": rate(easyRanks, 3), "recall@6": rate(easyRanks, 6), MRR: mrr(easyRanks) },
    hard: { "complete@1": rate(hardRanks, 1), "complete@3": rate(hardRanks, 3), "complete@6": rate(hardRanks, 6), MRR: mrr(hardRanks) },
  };
  per[variant] = { easy: easyRanks, hard: hardRanks };
}
report.rerankFallbacks = fallbacks;

console.log(JSON.stringify(report, null, 2));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ report, perQuestion: per }, null, 1));

const reranked = report.rerank as { easy: Record<string, number>; hard: Record<string, number> };
const failures = [
  fallbacks > 0 && `${fallbacks} searches fell back to the dense order`,
  reranked.easy["recall@1"]! < EASY_RECALL_AT_1 && `easy recall@1 ${reranked.easy["recall@1"]} < ${EASY_RECALL_AT_1}`,
  reranked.hard["complete@6"]! < HARD_COMPLETE_AT_6 && `hard complete@6 ${reranked.hard["complete@6"]} < ${HARD_COMPLETE_AT_6}`,
].filter(Boolean);
if (failures.length) {
  console.error(`FAIL: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("PASS: acceptance thresholds met.");
