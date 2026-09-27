// Load test for the public widget chat: N concurrent virtual Visitors, each
// holding a short conversation with a published assistant, exactly as the
// widget does it (POST /api/widget/{id}/chat, NDJSON stream, the conversation
// id carried from the `turn` event into the next message).
//
// Manual, never part of `pnpm verify`: it spends real model calls on whatever
// Provider Connection the assistant resolves to. Point it at staging or a
// local build, never at a customer's assistant. See
// docs/runbooks/widget-load-test.md for how to read the numbers.
//
// LOAD_BASE_URL=https://staging.example.com \
// LOAD_ASSISTANT_ID=asst_... \
// LOAD_VISITORS=200 LOAD_MESSAGES=3 \
// pnpm --filter @agent-hub/web load:widget-chat

const env = process.env;
const baseUrl = required("LOAD_BASE_URL");
const assistantId = required("LOAD_ASSISTANT_ID");
const visitors = integer("LOAD_VISITORS", 50, 1, 5_000);
const messagesPerVisitor = integer("LOAD_MESSAGES", 3, 1, 50);
const thinkMs = integer("LOAD_THINK_MS", 3_000, 0, 120_000);
const rampMs = integer("LOAD_RAMP_MS", 10_000, 0, 600_000);
const timeoutMs = integer("LOAD_TIMEOUT_MS", 300_000, 1_000, 900_000);
// Faults (not overloads) above this share of messages fail the run.
const maxFaultRate = Number(env.LOAD_MAX_FAULT_RATE ?? 0.01);
// Only meaningful where the app trusts X-Forwarded-For from the client (a
// local build, a self-host without a proxy). Behind Vercel the edge replaces
// the header, so every Visitor shares the load generator's one address and
// meets the 300-a-minute address budget; see the runbook.
const spoofAddresses = env.LOAD_SPOOF_ADDRESSES === "1";
const origin = env.LOAD_ORIGIN;
const jsonPath = env.LOAD_JSON;
const questions = (env.LOAD_QUESTIONS ?? "")
  .split("|")
  .map((q) => q.trim())
  .filter(Boolean);
const DEFAULT_QUESTIONS = [
  "What are your opening hours?",
  "How do I reset my password?",
  "Who can I contact for help with my account?",
  "Where can I find the latest announcements?",
  "What documents do I need to get started?",
];

function required(name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (ms) => ms / 2 + Math.random() * ms;

function fakeAddress(index) {
  return `198.18.${Math.floor(index / 250) % 250}.${(index % 250) + 1}`;
}

/**
 * One message, start to finish. Outcomes:
 * - `answered`: the stream ended on `done`.
 * - `busy` / `rate_limited`: the runtime refused for capacity (an `error`
 *   event carrying `code`). Expected under overload, reported apart from faults.
 * - `throttled`: the route's per-caller 429, before any turn started.
 * - `error`: an `error` event with no code, a non-OK status, a stream that
 *   ended without `done`, a timeout or a network failure. These are faults.
 */
async function sendMessage({ visitorId, address, conversationId, message }) {
  const started = performance.now();
  const result = {
    outcome: "error",
    status: 0,
    ttfbMs: null,
    firstTokenMs: null,
    totalMs: null,
    conversationId,
    detail: "",
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(`/api/widget/${assistantId}/chat`, baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
        ...(spoofAddresses ? { "X-Forwarded-For": address } : {}),
      },
      body: JSON.stringify({
        visitorId,
        conversationId,
        message,
        turnId: crypto.randomUUID(),
      }),
      signal: controller.signal,
    });
    result.status = response.status;
    result.ttfbMs = performance.now() - started;
    if (response.status === 429) {
      result.outcome = "throttled";
      await response.arrayBuffer();
      return result;
    }
    if (!response.ok || !response.body) {
      result.detail = `HTTP ${response.status}`;
      await response.arrayBuffer().catch(() => {});
      return result;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let ended = false;
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === "turn") result.conversationId = event.conversationId;
        if (
          result.firstTokenMs === null &&
          (event.type === "text-delta" || event.type === "part")
        ) {
          result.firstTokenMs = performance.now() - started;
        }
        if (event.type === "done") {
          result.outcome = "answered";
          ended = true;
        }
        if (event.type === "error") {
          result.outcome = event.code ?? "error";
          result.detail = event.message ?? "";
          ended = true;
        }
      }
    }
    if (!ended) result.detail = "stream ended without done";
  } catch (error) {
    result.detail = controller.signal.aborted
      ? `timeout after ${timeoutMs}ms`
      : String(error?.cause?.code ?? error?.message ?? error);
  } finally {
    clearTimeout(timer);
    result.totalMs = performance.now() - started;
  }
  return result;
}

const results = [];
let inFlight = 0;
let peak = 0;

async function visitor(index) {
  // Spread the arrivals: a real audience does not open the widget in the same
  // millisecond, and a load test that does measures the ramp, not the system.
  await sleep((index / visitors) * rampMs);
  const visitorId = `load-${crypto.randomUUID()}`;
  const address = fakeAddress(index);
  const pool = questions.length > 0 ? questions : DEFAULT_QUESTIONS;
  let conversationId = null;
  for (let turn = 0; turn < messagesPerVisitor; turn++) {
    const message = pool[(index + turn) % pool.length];
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    const result = await sendMessage({ visitorId, address, conversationId, message });
    inFlight -= 1;
    results.push({ visitor: index, turn, ...result });
    conversationId = result.conversationId ?? conversationId;
    if (turn < messagesPerVisitor - 1) await sleep(jitter(thinkMs));
  }
}

function percentile(values, rank) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil((rank / 100) * ordered.length) - 1)];
}

function ms(value) {
  return value === null ? "-" : `${(value / 1000).toFixed(2)}s`;
}

const wallStart = performance.now();
console.log(
  `Widget load: ${visitors} visitors x ${messagesPerVisitor} messages against ` +
    `${baseUrl} (assistant ${assistantId}), ramp ${ms(rampMs)}, think ~${ms(thinkMs)}`
);

const progress = setInterval(() => {
  console.log(
    `  ${ms(performance.now() - wallStart)} elapsed, ${results.length}/${
      visitors * messagesPerVisitor
    } messages done, ${inFlight} in flight`
  );
}, 10_000);

await Promise.all(Array.from({ length: visitors }, (_, index) => visitor(index)));
clearInterval(progress);

const wallMs = performance.now() - wallStart;
const byOutcome = new Map();
for (const result of results) {
  byOutcome.set(result.outcome, (byOutcome.get(result.outcome) ?? 0) + 1);
}
const answered = results.filter((r) => r.outcome === "answered");
const faults = results.filter((r) => r.outcome === "error");
const total = results.length;
const share = (n) => `${((n / total) * 100).toFixed(1)}%`;

console.log(`\nFinished ${total} messages in ${ms(wallMs)}, peak ${peak} in flight.`);
console.log("\nOutcomes");
for (const outcome of ["answered", "busy", "rate_limited", "throttled", "error"]) {
  const count = byOutcome.get(outcome) ?? 0;
  console.log(`  ${outcome.padEnd(13)} ${String(count).padStart(6)}  ${share(count)}`);
}

const rows = [
  ["time to headers", answered.map((r) => r.ttfbMs)],
  ["time to first token", answered.map((r) => r.firstTokenMs).filter((v) => v !== null)],
  ["time to done", answered.map((r) => r.totalMs)],
];
console.log("\nAnswered messages      p50      p90      p99      max");
for (const [label, values] of rows) {
  console.log(
    `  ${label.padEnd(20)} ${ms(percentile(values, 50)).padStart(7)}  ${ms(
      percentile(values, 90)
    ).padStart(7)}  ${ms(percentile(values, 99)).padStart(7)}  ${ms(
      percentile(values, 100)
    ).padStart(7)}`
  );
}
console.log(`  throughput           ${((answered.length / wallMs) * 60_000).toFixed(1)} answers/min`);

if (faults.length > 0) {
  const reasons = new Map();
  for (const fault of faults) {
    const key = fault.detail || `HTTP ${fault.status}`;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  console.log("\nFaults");
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(count).padStart(6)}  ${reason.slice(0, 120)}`);
  }
}

if (jsonPath) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        config: { baseUrl, assistantId, visitors, messagesPerVisitor, thinkMs, rampMs },
        wallMs,
        peakInFlight: peak,
        results,
      },
      null,
      2
    )
  );
  console.log(`\nPer-message results written to ${jsonPath}`);
}

const faultRate = total === 0 ? 1 : faults.length / total;
if (faultRate > maxFaultRate) {
  console.error(
    `\nFAIL: ${share(faults.length)} of messages faulted (limit ${(maxFaultRate * 100).toFixed(1)}%). ` +
      "Overloads (busy, rate_limited, throttled) are not faults; these are."
  );
  process.exit(1);
}
console.log(`\nPASS: fault rate ${share(faults.length)} within ${(maxFaultRate * 100).toFixed(1)}%.`);
