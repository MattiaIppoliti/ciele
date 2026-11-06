import { AsyncLocalStorage } from "node:async_hooks";
import type { LanguageModelMiddleware } from "ai";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type {
  AiUsageStage,
  IngestTimings,
  TurnTimings,
  TurnTrigger,
  TurnWaitKind,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

/**
 * Where a Conversation Turn's wall time goes (#1112).
 *
 * `runtime_events.duration_ms` is the whole turn, and nothing else stored said
 * how much of it was the model, the database, or our own code. That split is
 * what decides whether rewriting the server pays (map #1111), so the turn
 * records it, the same way the PII masker reaches every model call: the turn
 * opens a clock (`withTurnClock`, an AsyncLocalStorage scope) and the places
 * every external wait already passes write to it.
 *
 * - `buildModel` puts {@link turnClockMiddleware} on every language model, so
 *   each step of an agent loop counts as its own model wait and the tools run
 *   between steps do not. The call is filed under the `ai_usage` stage of the
 *   enclosing {@link withModelStage} scope, `generate` when there is none.
 * - Embeddings, rerank and Jev's `decide()` are not language models; they call
 *   {@link timedWait} around their request.
 * - The turn's own `Db` handles go through {@link timedDb}; the vector search
 *   methods count as `retrieval`, everything else as `db`.
 * - Every tool reports its end through the turn observer (`toolEnd`).
 *
 * Waits overlap (the pre-flight runs beside Intent Classification, a query
 * embeds while history loads), so each figure is the **union** of its
 * intervals, never a sum, and `waitMs` is the union of all of them. What is
 * left of the turn's duration after `waitMs` is time no external call was in
 * flight: our code, plus anything unclocked.
 *
 * CPU is `process.cpuUsage()` across the turn, which is process-wide. It is
 * an upper bound on this turn's CPU even when `overlap` is 1: unclocked
 * page renders or maintenance can share the process. `overlap` counts every
 * clock in flight, turns and job-layer jobs alike (`runClaimedJob` opens a
 * `job` clock for each), so a job draining beside a turn is not invisible.
 *
 * Outside a scope every function here is a no-op.
 */

type Interval = [start: number, end: number];

/** A turn answers someone; a job is everything the job layer runs. */
export type ClockKind = "turn" | "job";

/**
 * How long a clock may count as in flight without settling. A turn settles
 * when its stream ends, errors, is cancelled or its signal aborts; a stream
 * that is never read and never aborted would otherwise inflate every later
 * turn's `overlap` for the life of the process. Longer than any function
 * timeout we deploy with.
 */
export const MAX_LIVE_MS = 15 * 60_000;

export class TurnClock {
  private readonly intervals = new Map<TurnWaitKind, Interval[]>();
  private readonly modelStages = new Map<AiUsageStage, Interval[]>();
  private readonly toolIntervals = new Map<string, Interval[]>();
  private readonly toolCallIds = new Set<string>();
  private readonly startedAt: number;
  private readonly cpuStart: NodeJS.CpuUsage;
  private firstTokenAt: number | null = null;
  private modelCalls = 0;
  private concepts = 0;
  readonly kind: ClockKind;
  trigger: TurnTrigger = "live";
  /** The most clocks this process held at once while this one ran. */
  overlap = 1;
  /** The most of those that were jobs. */
  jobsInFlight = 0;

  constructor(startedAt = performance.now(), kind: ClockKind = "turn") {
    this.startedAt = startedAt;
    this.kind = kind;
    this.cpuStart = process.cpuUsage();
  }

  wait(kind: TurnWaitKind, start: number, end: number): void {
    if (kind === "model") this.modelCalls += 1;
    push(this.intervals, kind, [start, Math.max(start, end)]);
  }

  /** One language-model call, filed under the `ai_usage` stage it ran for. */
  modelWait(stage: AiUsageStage, start: number, end: number): void {
    this.wait("model", start, end);
    push(this.modelStages, stage, [start, Math.max(start, end)]);
  }

  /**
   * A tool call ended `durationMs` ago-ish: now. Keyed by call id, because
   * one call's `tool-end` can pass through two observers (a Teammate turn
   * folds its own before the turn's), and the first report is the timely one.
   */
  toolEnd(callId: string, tool: string, durationMs: number, end = performance.now()): void {
    if (this.toolCallIds.has(callId)) return;
    this.toolCallIds.add(callId);
    const interval: Interval = [end - Math.max(0, durationMs), end];
    push(this.intervals, "tool", interval);
    push(this.toolIntervals, tool, interval);
  }

  /** The first newly generated text the turn put on the wire. Later calls are ignored. */
  markFirstToken(at = performance.now()): void {
    this.firstTokenAt ??= at;
  }

  /** Ingestion: how many Concept drafts the job wrote. */
  countConcepts(count: number): void {
    this.concepts += count;
  }

  /** Called by the in-flight registry whenever work enters it. */
  noteInFlight(total: number, jobs: number): void {
    this.overlap = Math.max(this.overlap, total);
    this.jobsInFlight = Math.max(this.jobsInFlight, jobs);
  }

  private of(kind: TurnWaitKind): number {
    return unionMs(this.intervals.get(kind) ?? []);
  }

  private cpuMs(): number {
    const cpu = process.cpuUsage(this.cpuStart);
    return Math.round((cpu.user + cpu.system) / 1000);
  }

  summary(): TurnTimings {
    const modelMsByStage: TurnTimings["modelMsByStage"] = {};
    for (const [stage, list] of this.modelStages) modelMsByStage[stage] = unionMs(list);
    const tools: TurnTimings["tools"] = {};
    for (const [name, list] of this.toolIntervals) {
      tools[name] = { calls: list.length, ms: unionMs(list) };
    }
    return {
      firstTokenMs:
        this.firstTokenAt === null ? null : Math.round(this.firstTokenAt - this.startedAt),
      queueMs: this.of("queue"),
      modelMs: this.of("model"),
      modelMsByStage,
      modelCallTimings: [...this.modelStages].flatMap(([stage, list]) =>
        list.map(([start, end]) => ({ stage, ms: Math.round(end - start) }))
      ),
      embedMs: this.of("embed"),
      rerankMs: this.of("rerank"),
      decideMs: this.of("decide"),
      dbMs: this.of("db"),
      retrievalMs: this.of("retrieval"),
      toolMs: this.of("tool"),
      tools,
      toolCallTimings: [...this.toolIntervals].flatMap(([tool, list]) =>
        list.map(([start, end]) => ({ tool, ms: Math.round(end - start) }))
      ),
      waitMs: unionMs([...this.intervals.values()].flat()),
      modelCalls: this.modelCalls,
      cpuMs: this.cpuMs(),
      overlap: this.overlap,
      jobsInFlight: this.jobsInFlight,
      trigger: this.trigger,
    };
  }

  ingestSummary(): IngestTimings {
    return {
      parseMs: this.of("parse"),
      chunkMs: this.of("chunk"),
      embedMs: this.of("embed"),
      dbMs: unionMs([
        ...(this.intervals.get("db") ?? []),
        ...(this.intervals.get("retrieval") ?? []),
      ]),
      waitMs: unionMs([...this.intervals.values()].flat()),
      concepts: this.concepts,
      cpuMs: this.cpuMs(),
      overlap: this.overlap,
      jobsInFlight: this.jobsInFlight,
    };
  }
}

function push<K>(map: Map<K, Interval[]>, key: K, interval: Interval): void {
  const list = map.get(key);
  if (list) list.push(interval);
  else map.set(key, [interval]);
}

/** Total length covered by `intervals`, counting overlaps once. Rounded ms. */
export function unionMs(intervals: readonly Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: Interval | null = null;
  for (const [start, end] of sorted) {
    if (!current || start > current[1]) {
      if (current) total += current[1] - current[0];
      current = [start, end];
    } else if (end > current[1]) {
      current[1] = end;
    }
  }
  if (current) total += current[1] - current[0];
  return Math.round(total);
}

/** On `globalThis` for the reason `pii-masking.ts` gives. */
const SCOPE_SLOT = Symbol.for("@agent-hub/agent:turn-clock-scope");
const STAGE_SLOT = Symbol.for("@agent-hub/agent:turn-clock-stage");
const LIVE_SLOT = Symbol.for("@agent-hub/agent:turn-clock-live");
const slots = globalThis as {
  [SCOPE_SLOT]?: AsyncLocalStorage<TurnClock>;
  [STAGE_SLOT]?: AsyncLocalStorage<AiUsageStage>;
  [LIVE_SLOT]?: Set<TurnClock>;
};
const active: AsyncLocalStorage<TurnClock> = (slots[SCOPE_SLOT] ??= new AsyncLocalStorage<TurnClock>());
const stageScope: AsyncLocalStorage<AiUsageStage> = (slots[STAGE_SLOT] ??= new AsyncLocalStorage<AiUsageStage>());
const live: Set<TurnClock> = (slots[LIVE_SLOT] ??= new Set<TurnClock>());

/**
 * Runs `run` with `clock` active for every wait it makes. The clock counts as
 * live, for `overlap`, until `settled` resolves (a turn's work outlives the
 * call that returns its stream), or until `run`'s own promise settles when no
 * `settled` is given, and never longer than `maxLiveMs`.
 */
export function withTurnClock<T>(
  clock: TurnClock,
  run: () => T,
  options: { settled?: Promise<unknown>; maxLiveMs?: number } = {}
): T {
  live.add(clock);
  let jobs = 0;
  for (const work of live) if (work.kind === "job") jobs += 1;
  for (const work of live) work.noteInFlight(live.size, jobs);
  let left = false;
  const timer = setTimeout(() => leave(), options.maxLiveMs ?? MAX_LIVE_MS);
  // Never the reason a process stays up.
  (timer as { unref?: () => void }).unref?.();
  function leave() {
    if (left) return;
    left = true;
    clearTimeout(timer);
    live.delete(clock);
  }
  let result: T;
  try {
    result = active.run(clock, run);
  } catch (error) {
    leave();
    throw error;
  }
  const settled = options.settled ?? (isThenable(result) ? result : undefined);
  if (settled) Promise.resolve(settled).then(leave, leave);
  else leave();
  return result;
}

export function activeTurnClock(): TurnClock | undefined {
  return active.getStore();
}

/**
 * Files the language-model calls `run` makes under `stage`, the `ai_usage`
 * stage the same calls are metered as. Only the stages a turn runs besides
 * `generate` need a scope; an unscoped call is `generate`.
 */
export function withModelStage<T>(stage: AiUsageStage, run: () => T): T {
  return stageScope.run(stage, run);
}

/** `work`, with its wall time recorded on the active clock as `kind`. */
export async function timedWait<T>(kind: TurnWaitKind, work: () => PromiseLike<T>): Promise<T> {
  const clock = active.getStore();
  if (!clock) return work();
  const start = performance.now();
  try {
    return await work();
  } finally {
    clock.wait(kind, start, performance.now());
  }
}

/** Synchronous `work` (parsing, chunking), timed on the active clock as `kind`. */
export function timedSync<T>(kind: TurnWaitKind, work: () => T): T {
  const clock = active.getStore();
  if (!clock) return work();
  const start = performance.now();
  try {
    return work();
  } finally {
    clock.wait(kind, start, performance.now());
  }
}

/**
 * Times each language-model call. A stream counts until it ends, errors or is
 * cancelled, so a step that streams for 9 s is 9 s of model wait, not the
 * 400 ms to its headers.
 */
export function turnClockMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate }) => {
      const clock = active.getStore();
      if (!clock) return doGenerate();
      const stage = stageScope.getStore() ?? "generate";
      const start = performance.now();
      try {
        return await doGenerate();
      } finally {
        clock.modelWait(stage, start, performance.now());
      }
    },
    wrapStream: async ({ doStream }) => {
      const clock = active.getStore();
      if (!clock) return doStream();
      const stage = stageScope.getStore() ?? "generate";
      const start = performance.now();
      let result: Awaited<ReturnType<typeof doStream>>;
      try {
        result = await doStream();
      } catch (error) {
        clock.modelWait(stage, start, performance.now());
        throw error;
      }
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clock.modelWait(stage, start, performance.now());
      };
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
            transform(part, controller) {
              if (part.type === "error") close();
              controller.enqueue(part);
            },
            flush: close,
            // The reader gave up (an abort). The Streams spec and Node call a
            // transformer's `cancel`; the DOM lib type predates it, hence the
            // cast. `turn-clock.test.ts` pins that it runs.
            cancel: close,
          } as Transformer<LanguageModelV4StreamPart, LanguageModelV4StreamPart>)
        ),
      };
    },
  };
}

/** The `Db` methods that run a vector search (`match_chunks*`, `match_memories`). */
const RETRIEVAL_METHODS: ReadonlySet<PropertyKey> = new Set([
  "searchChunks",
  "searchCollectionChunks",
  "searchSourceChunks",
  "searchMemories",
]);

/**
 * `db` with every async method's wall time recorded as a `db` wait, or as
 * `retrieval` for the vector searches. Methods are bound to the real adapter,
 * so an implementation with private fields behaves exactly as before. Outside
 * a clock scope the calls are untimed.
 */
export function timedDb<T extends Db>(db: T): T {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const kind: TurnWaitKind = RETRIEVAL_METHODS.has(prop) ? "retrieval" : "db";
      return (...args: unknown[]) => {
        const clock = active.getStore();
        const start = clock ? performance.now() : 0;
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (!clock || !isThenable(result)) return result;
        const done = () => clock.wait(kind, start, performance.now());
        result.then(done, done);
        return result;
      };
    },
  });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}
