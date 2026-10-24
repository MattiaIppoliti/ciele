import { OrgPinnedDbError } from "@agent-hub/db";
import type { Role } from "@agent-hub/core";
import { OperationError } from "./errors";

/**
 * Running an operation somewhere else (#1121, map #1111).
 *
 * The Rust service (`services/ciele-api`) ports operations one domain at a
 * time. The calling surface stays exactly what it was, it authenticates,
 * checks the capability and validates, and only `run` moves: when an executor
 * is registered and lists the operation, `defineOperation`'s wrapper hands the
 * parsed input to it instead of running the TypeScript body. Taking the name
 * off the list puts the TypeScript body back, with no deploy of the service.
 *
 * Forwarded only when the context says which Db the surface resolved
 * (`dbScope`), because the service rebuilds that Db on its side, and never
 * for a Teammate or an agent author, whose grants and signatures the service
 * does not model.
 *
 * Framework-free like the rest of this package: signing uses Web Crypto.
 */

/** How the surface reached Postgres: the Member's RLS session, or an org-pinned service role. */
export type DbScope = "session" | "pinned";

/**
 * The operations `services/ciele-api` runs, and so the only ones this seam
 * will forward. None of them reads `ctx.ports`: an operation that does stays
 * in TypeScript until its port has a Rust side, because the service would
 * skip the side effect without a word. The parity test holds this list to
 * the service's own table (`GET /v1/ops`) and fails a case that reaches a port.
 */
export const RUST_OPERATIONS: ReadonlySet<string> = new Set([
  "alerts.list",
  "alerts.resolve",
  "alerts.update",
  "taskLabels.list",
  "taskLabels.create",
  "taskLabels.update",
  "taskLabels.delete",
  "improvements.list",
  "improvements.listPage",
  "improvements.fix.propose",
  "improvements.fix.dismiss",
]);

export interface RemoteOperationCall {
  operation: string;
  organizationId: string;
  userId: string;
  role: Role;
  dbScope: DbScope;
  /** Goes into the session's JWT claims, as it is in the Member's own token. */
  actorEmail?: string | null;
  input: unknown;
  signal?: AbortSignal;
}

export type RemoteExecutor = (call: RemoteOperationCall) => Promise<unknown>;

interface Registration {
  executor: RemoteExecutor;
  operations: ReadonlySet<string>;
}

/** On `globalThis` for the reason `pii-masking.ts` gives: one registry per process, not per bundle. */
const SLOT = Symbol.for("@ciele/ops:remote-executor");
const slots = globalThis as { [SLOT]?: Registration | null };

/**
 * Route `operations` to `executor`. `null` routes everything back to
 * TypeScript. A name the service does not run (a typo, an operation not
 * ported yet, one that needs a port) is dropped with a warning and keeps
 * running here, rather than failing every call to it.
 */
export function registerRemoteExecutor(
  executor: RemoteExecutor | null,
  operations: Iterable<string> = []
): void {
  if (!executor) {
    slots[SLOT] = null;
    return;
  }
  const listed = [...operations];
  const notPorted = listed.filter((name) => !RUST_OPERATIONS.has(name));
  if (notPorted.length > 0) {
    console.warn(
      `[ciele-api] ${notPorted.join(", ")} cannot run in the Rust service; running in TypeScript instead.`
    );
  }
  slots[SLOT] = { executor, operations: new Set(listed.filter((name) => RUST_OPERATIONS.has(name))) };
}

/** What `remoteExecutorFor` reads from an `OperationContext`. */
export interface ForwardingContext {
  dbScope?: DbScope;
  teammate?: unknown;
  agentAuthor?: unknown;
}

/** The executor that should run `operation` for `ctx`, or null to run it here. */
export function remoteExecutorFor(
  operation: string,
  ctx: ForwardingContext
): RemoteExecutor | null {
  const registration = slots[SLOT];
  if (!registration || !registration.operations.has(operation)) return null;
  if (!ctx.dbScope || ctx.teammate || ctx.agentAuthor) return null;
  return registration.executor;
}

export const ASSERTION_HEADER = "x-ciele-assertion";
/** Seconds an assertion is valid for. The service refuses anything over 60. */
const ASSERTION_TTL_SECONDS = 30;

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The assertion `services/ciele-api/src/assertion.rs` verifies:
 * `base64url(claims).base64url(hmac_sha256(secret, base64url(claims)))`.
 * The claims name the operation and carry the SHA-256 of `body`, the exact
 * bytes sent, so one minted for a read cannot run a write and one minted for
 * one row cannot be pointed at another.
 */
export async function signAssertion(
  secret: string,
  call: Pick<RemoteOperationCall, "operation" | "organizationId" | "userId" | "role" | "dbScope" | "actorEmail">,
  body: string,
  now = Date.now()
): Promise<string> {
  const { subtle } = globalThis.crypto;
  const digest = new Uint8Array(await subtle.digest("SHA-256", encoder.encode(body)));
  const claims = {
    op: call.operation,
    org: call.organizationId,
    sub: call.userId,
    email: call.actorEmail ?? null,
    role: call.role,
    scope: call.dbScope,
    body: base64url(digest),
    exp: Math.floor(now / 1000) + ASSERTION_TTL_SECONDS,
  };
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  const key = await subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = new Uint8Array(await subtle.sign("HMAC", key, encoder.encode(payload)));
  return `${payload}.${base64url(signature)}`;
}

const OPERATION_ERROR_CODES = new Set<string>(["not_found", "invalid_input", "conflict"]);

/**
 * The executor that posts to the Rust service. Its `not_found`,
 * `invalid_input` and `conflict` come back as the `OperationError` the
 * TypeScript body would have thrown, so neither surface can tell which side
 * ran; anything else is a server fault and throws as one. A service that is
 * down fails the call: there is no fallback to TypeScript (RUNBOOK.md).
 */
export function createHttpRemoteExecutor(options: {
  baseUrl: string;
  secret: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): RemoteExecutor {
  const send = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/+$/, "");
  return async (call) => {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    const body = JSON.stringify(call.input ?? {});
    const response = await send(`${base}/v1/ops/${encodeURIComponent(call.operation)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [ASSERTION_HEADER]: await signAssertion(options.secret, call, body),
      },
      body,
      signal: call.signal ? AbortSignal.any([call.signal, timeout]) : timeout,
    });
    const answer = (await response.json().catch(() => null)) as
      | { result?: unknown; error?: { code?: string; message?: string } }
      | null;
    if (response.ok && answer && "result" in answer) return answer.result;
    const code = answer?.error?.code ?? "";
    const message = answer?.error?.message ?? `ciele-api answered ${response.status}`;
    if (code === "cross_org" && call.operation === "improvements.fix.dismiss" && call.dbScope === "pinned") {
      throw new OrgPinnedDbError("getImprovementProposal", "cross_org");
    }
    if (OPERATION_ERROR_CODES.has(code)) {
      throw new OperationError(code as OperationError["code"], message);
    }
    throw new Error(`ciele-api ${call.operation} failed: ${response.status} ${code || message}`);
  };
}
