import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/** Identifiers only: payloads, credentials and free-form errors have no slot. */
export interface DiagnosticContext {
  requestId?: string;
  traceId?: string;
  route?: string;
  method?: string;
  surface?: string;
  operation?: string;
  organizationId?: string;
  assistantId?: string;
  conversationId?: string;
  sourceId?: string;
  jobId?: string;
  jobKind?: string;
  queue?: string;
  routeType?: string;
  count?: number;
  attempt?: number;
  ageSeconds?: number;
}

export interface DiagnosticOutcome {
  status: "succeeded" | "failed" | "rejected" | "retried" | "superseded";
  statusCode?: number;
}

const contextStore = new AsyncLocalStorage<DiagnosticContext>();
const STRING_FIELDS = [
  "requestId", "traceId", "route", "method", "surface", "operation",
  "organizationId", "assistantId", "conversationId", "sourceId",
  "jobId", "jobKind", "queue", "routeType",
] as const;
const TOKEN = /^[a-zA-Z0-9_./:[\](){}-]{1,200}$/;

/** A runtime allow-list as well as a type: spread objects cannot leak fields. */
function safeContext(context: DiagnosticContext): DiagnosticContext {
  const safe: DiagnosticContext = {};
  try {
    for (const key of STRING_FIELDS) {
      const value = context[key];
      if (typeof value === "string" && TOKEN.test(value)) safe[key] = value;
    }
    for (const key of ["count", "attempt", "ageSeconds"] as const) {
      const value = context[key];
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        safe[key] = value;
      }
    }
  } catch {
    // A malformed context must not interrupt the observed work either.
  }
  return safe;
}

/** Add context for this async chain; sibling requests never share it. */
export function withDiagnosticContext<T>(
  context: DiagnosticContext,
  work: () => T
): T {
  return contextStore.run({
    traceId: randomUUID().replaceAll("-", ""),
    ...contextStore.getStore(),
    ...safeContext(context),
  }, work);
}

/** Select a correlation header, never a URL, cookie, token or request body. */
export function requestIdFromHeaders(headers: Pick<Headers, "get">): string {
  for (const name of ["x-vercel-id", "x-request-id"]) {
    const value = headers.get(name);
    if (value && TOKEN.test(value)) return value;
  }
  return contextStore.getStore()?.requestId ?? randomUUID();
}

function errorFields(error: unknown): { errorClass: string; errorCode?: string } {
  try {
    const name = error instanceof Error ? error.name : "UnknownError";
    const errorClass = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) ? name : "Error";
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    // These are public operation failures, not provider response contents.
    if (code === "not_found" || code === "invalid_input" || code === "conflict") {
      return { errorClass, errorCode: code };
    }
    return { errorClass };
  } catch {
    return { errorClass: "UnknownError" };
  }
}

function emit(
  name: string,
  outcome: { status: DiagnosticOutcome["status"] | "started"; statusCode?: number },
  context: DiagnosticContext,
  durationMs?: number,
  error?: { errorClass: string; errorCode?: string }
): void {
  try {
    const level = outcome.status === "failed" ? "error"
      : outcome.status === "rejected" || outcome.status === "retried" ? "warn" : "info";
    const statusCode = outcome.statusCode;
    const record = JSON.stringify({
      ...contextStore.getStore(),
      ...safeContext(context),
      timestamp: new Date().toISOString(),
      event: TOKEN.test(name) ? name : "diagnostic",
      level,
      status: outcome.status,
      ...(typeof statusCode === "number" && Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
        ? { statusCode } : {}),
      ...(durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(durationMs)) }),
      ...error,
    });
    if (level === "error") console.error(record);
    else if (level === "warn") console.warn(record);
    else console.log(record);
  } catch {
    // Diagnostics must never change a result, retry, response or thrown value.
  }
}

/** One safe error record, including context inherited from the caller. */
export function reportError(
  name: string,
  error: unknown,
  context: DiagnosticContext = {}
): void {
  emit(name, { status: "failed" }, context, undefined, error === undefined ? undefined : errorFields(error));
}

/** Observe the public work, preserving its result and the original exception. */
export async function observe<T>(
  options: {
    name: string;
    context?: DiagnosticContext;
    outcome?: (result: T) => DiagnosticOutcome;
  },
  work: () => Promise<T>
): Promise<T> {
  return withDiagnosticContext(options.context ?? {}, async () => {
    const start = performance.now();
    emit(options.name, { status: "started" }, {});
    let result: T;
    try {
      result = await work();
    } catch (error) {
      const fields = errorFields(error);
      emit(options.name, { status: fields.errorCode ? "rejected" : "failed" }, {}, performance.now() - start, fields);
      throw error;
    }
    let outcome: DiagnosticOutcome = { status: "succeeded" };
    try {
      outcome = options.outcome?.(result) ?? outcome;
    } catch {
      // Even an observer callback's failure cannot turn completed work red.
    }
    emit(options.name, outcome, {}, performance.now() - start);
    return result;
  });
}
