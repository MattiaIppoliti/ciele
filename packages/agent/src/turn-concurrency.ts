import type { Provider } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { reportError } from "@agent-hub/diagnostics";

import type { ProviderCredential } from "./models";
import type { TurnOverloadCode } from "./types";

/**
 * How many model-backed turns may run at once, and what happens to the next one.
 *
 * The provider's rate limit is the real ceiling under load, and the platform
 * key is one key shared by every Organization on it. Without a budget of our
 * own, a traffic spike on one tenant's widget spends that key for everybody,
 * and past the limit every turn in flight starts collecting 429s together.
 * So a turn takes a slot before its first model call:
 *
 * - `org:<id>`, per Organization, always. One tenant cannot take the whole
 *   deployment, whichever key it runs on.
 * - `platform:<provider>`, only on the platform credential, sized to what the
 *   shared key sustains.
 *
 * A BYOK turn has no platform scope: the key is the Organization's own and so
 * is its rate limit. A local CLI subscription takes no slot at all, it is one
 * Member's own process on their own machine.
 *
 * The slots live in Postgres (`turn_concurrency_leases`) rather than in process
 * memory, because on serverless every instance would otherwise count only its
 * own turns and the limit would scale with the instance count. A full scope
 * does not refuse at once: the turn waits in a short jittered queue, since most
 * slots free within seconds, and only a queue wait that runs out answers
 * `busy` with a retry hint.
 *
 * The posture is **fail open**. This is a throughput guard, not a spend or an
 * access control (those fail closed, `spend-admission.ts`), so a lease store
 * that errors, or a schema one migration behind, lets the turn run unmetered
 * rather than turn a database hiccup into a chat outage.
 */

export interface TurnConcurrencyLimits {
  /** Null means unlimited: the scope is not taken at all. */
  perOrganization: number | null;
  perPlatformProvider: number | null;
  /** How long a turn waits for a slot before answering `busy`. */
  queueWaitMs: number;
}

/**
 * Defaults sized for one shared platform key: a turn makes a handful of model
 * calls over ~10–20s, so 200 concurrent turns is on the order of 4k requests a
 * minute, which is where the large providers' higher tiers sit. Measure before
 * raising them (`docs/runbooks/widget-load-test.md`).
 */
export const DEFAULT_TURN_CONCURRENCY: TurnConcurrencyLimits = {
  perOrganization: 50,
  perPlatformProvider: 200,
  queueWaitMs: 15_000,
};

/**
 * Longer than the chat route's 300s `maxDuration`, so a live turn never loses
 * its slot, and short enough that a killed function's slot comes back within
 * six minutes without anything sweeping it.
 */
export const TURN_LEASE_MS = 330_000;

/**
 * `CHAT_MAX_CONCURRENT_TURNS_PER_ORG` and
 * `CHAT_MAX_CONCURRENT_TURNS_PER_PLATFORM_PROVIDER`: a positive integer sets
 * the limit, `0` or `off` removes it, anything else keeps the default.
 * `CHAT_TURN_QUEUE_WAIT_MS`: a whole number of milliseconds, `0` meaning
 * "answer busy at once"; capped at 60s so a queued turn keeps most of the
 * route's 300s for the answer.
 */
export function turnConcurrencyLimits(
  env: Record<string, string | undefined> = process.env
): TurnConcurrencyLimits {
  return {
    perOrganization: parseLimit(
      env.CHAT_MAX_CONCURRENT_TURNS_PER_ORG,
      DEFAULT_TURN_CONCURRENCY.perOrganization
    ),
    perPlatformProvider: parseLimit(
      env.CHAT_MAX_CONCURRENT_TURNS_PER_PLATFORM_PROVIDER,
      DEFAULT_TURN_CONCURRENCY.perPlatformProvider
    ),
    queueWaitMs: parseWait(env.CHAT_TURN_QUEUE_WAIT_MS),
  };
}

function parseWait(raw: string | undefined): number {
  const parsed = Number(raw?.trim() || Number.NaN);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_TURN_CONCURRENCY.queueWaitMs;
  return Math.min(parsed, 60_000);
}

function parseLimit(raw: string | undefined, fallback: number | null): number | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "off" || value === "0") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export interface ConcurrencyScope {
  key: string;
  limit: number;
}

export function turnConcurrencyScopes(
  turn: {
    organizationId: string;
    provider: Provider;
    credentialKind: ProviderCredential["kind"];
  },
  limits: TurnConcurrencyLimits
): ConcurrencyScope[] {
  if (turn.credentialKind === "local_subscription") return [];
  const scopes: ConcurrencyScope[] = [];
  if (limits.perOrganization !== null) {
    scopes.push({ key: `org:${turn.organizationId}`, limit: limits.perOrganization });
  }
  if (turn.credentialKind === "platform" && limits.perPlatformProvider !== null) {
    scopes.push({ key: `platform:${turn.provider}`, limit: limits.perPlatformProvider });
  }
  return scopes;
}

export type TurnSlot =
  | { status: "admitted"; release: () => Promise<void> }
  | { status: "busy"; retryAfterMs: number };

/** The turn could not get a slot within the queue wait. */
export class TurnBusyError extends Error {
  override readonly name = "TurnBusyError";
  constructor(readonly retryAfterMs: number) {
    super("Every conversation slot is in use");
  }
}

const NO_SLOT: TurnSlot = { status: "admitted", release: async () => {} };

export async function admitTurnConcurrency(options: {
  db: Pick<Db, "acquireTurnConcurrency" | "releaseTurnConcurrency">;
  scopes: ConcurrencyScope[];
  signal?: AbortSignal;
  maxWaitMs?: number;
  leaseMs?: number;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}): Promise<TurnSlot> {
  const { db, scopes, signal } = options;
  if (scopes.length === 0) return NO_SLOT;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_TURN_CONCURRENCY.queueWaitMs;
  const leaseMs = options.leaseMs ?? TURN_LEASE_MS;
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;
  const started = clock();

  for (let attempt = 0; ; attempt++) {
    const now = clock();
    let leaseId: string | null;
    try {
      leaseId = await db.acquireTurnConcurrency({
        scopes,
        now: new Date(now).toISOString(),
        expiresAt: new Date(now + leaseMs).toISOString(),
      });
    } catch (error) {
      reportError("turn.capacity.acquire", error);
      return NO_SLOT;
    }
    if (leaseId) return { status: "admitted", release: releaser(db, leaseId) };

    const delay = queueDelayMs(attempt, random);
    if (signal?.aborted || clock() - started + delay > maxWaitMs) {
      return { status: "busy", retryAfterMs: busyRetryAfterMs(random) };
    }
    await sleep(delay);
  }
}

/**
 * Equal jitter from 250ms up to a 3s step: half the step is fixed so a waiting
 * turn polls at a bounded rate, half is random so a queue of hundreds does not
 * poll Postgres in lockstep.
 */
export function queueDelayMs(attempt: number, random: () => number): number {
  const step = Math.min(3_000, 250 * 2 ** attempt);
  return step / 2 + random() * (step / 2);
}

/** Spread the retries of everyone turned away in the same moment over 4–8s. */
export function busyRetryAfterMs(random: () => number): number {
  return Math.round(4_000 + random() * 4_000);
}

function releaser(
  db: Pick<Db, "releaseTurnConcurrency">,
  leaseId: string
): () => Promise<void> {
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    // A failed release is not worth failing a turn for: the lease expires.
    await db.releaseTurnConcurrency(leaseId).catch((error) => {
      reportError("turn.capacity.release", error);
    });
  };
}

/**
 * The overload a failed turn should report on the wire, or null for a fault.
 * Reads the cause chain via the caller-supplied provider check so this module
 * does not need the AI SDK.
 */
export function turnOverloadOf(
  error: unknown,
  providerRefusal: (error: unknown) => { retryAfterMs: number | null } | null
): { code: TurnOverloadCode; retryAfterMs: number } | null {
  if (error instanceof TurnBusyError) {
    return { code: "busy", retryAfterMs: error.retryAfterMs };
  }
  const refusal = providerRefusal(error);
  if (refusal) {
    return { code: "rate_limited", retryAfterMs: refusal.retryAfterMs ?? 10_000 };
  }
  return null;
}
