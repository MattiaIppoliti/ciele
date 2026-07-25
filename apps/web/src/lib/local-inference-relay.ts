import { createHash, randomBytes } from "node:crypto";
import type { LocalConnectorDevice } from "@agent-hub/db";
import type {
  LocalCliInvocation,
  LocalCliResult,
  LocalCliRunner,
} from "./local-subscription-model";
import type { LocalSubscriptionProvider } from "./local-subscriptions";
import {
  createRelayPairingCode,
  InvalidRelayPairingCodeError,
  verifyRelayPairingCode,
} from "./local-relay-pairing-code";
import { getRelayDb, isRelayDbConfigured } from "./relay-db";

const PAIRING_TTL_MS = 5 * 60_000;
const DEVICE_FRESH_MS = 30_000;
const JOB_TTL_MS = 3 * 60_000;
const POLL_MS = 350;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pairingSecret(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for relay pairing.");
  return secret;
}

function bearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/);
  return match?.[1] ?? null;
}

export async function createRelayPairing(input: {
  organizationId: string;
  userId: string;
  origin: string;
}): Promise<{ code: string }> {
  const code = createRelayPairingCode({
    origin: input.origin,
    secret: pairingSecret(),
  });
  await getRelayDb()
    .table("localConnectorPairings")
    .insert({
      organizationId: input.organizationId,
      userId: input.userId,
      codeHash: digest(code),
      origin: input.origin,
      expiresAt: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
    });
  return { code };
}

export async function exchangeRelayPairing(input: {
  code: string;
  origin: string;
}): Promise<{ token: string; deviceId: string }> {
  if (
    !verifyRelayPairingCode({
      code: input.code,
      origin: input.origin,
      secret: pairingSecret(),
    })
  ) {
    throw new InvalidRelayPairingCodeError();
  }

  const db = getRelayDb();
  const pairing = await db.consumeLocalConnectorPairing({
    codeHash: digest(input.code),
    origin: input.origin,
    now: new Date().toISOString(),
  });
  if (!pairing) throw new InvalidRelayPairingCodeError();

  const token = randomBytes(48).toString("base64url");
  const device = await db.table("localConnectorDevices").insert({
    organizationId: pairing.organizationId,
    userId: pairing.userId,
    tokenHash: digest(token),
    origin: pairing.origin,
  });
  return { token, deviceId: device.id };
}

async function authenticatedDevice(
  authorization: string | null
): Promise<LocalConnectorDevice | null> {
  const token = bearerToken(authorization);
  if (!token) return null;
  const devices = await getRelayDb()
    .table("localConnectorDevices")
    .list({ tokenHash: digest(token), revokedAt: null }, { limit: 1 });
  return devices[0] ?? null;
}

export async function claimRelayJob(input: {
  authorization: string | null;
  providers: LocalSubscriptionProvider[];
}): Promise<{ device: { origin: string }; job: Record<string, unknown> | null } | null> {
  const device = await authenticatedDevice(input.authorization);
  if (!device) return null;
  const db = getRelayDb();
  await db.table("localConnectorDevices").update(device.id, {
    providers: input.providers,
    lastSeenAt: new Date().toISOString(),
  });
  const job = await db.claimNextLocalInferenceJob({
    deviceId: device.id,
    now: new Date().toISOString(),
  });
  return {
    device: { origin: device.origin },
    // Wire shape the shipped connector script expects (snake_case model_id).
    job: job
      ? {
          id: job.id,
          provider: job.provider,
          model_id: job.modelId,
          invocation: job.invocation,
        }
      : null,
  };
}

export async function completeRelayJob(input: {
  authorization: string | null;
  jobId: string;
  result?: LocalCliResult;
  error?: string;
}): Promise<boolean> {
  const device = await authenticatedDevice(input.authorization);
  if (!device) return false;
  return getRelayDb().completeLocalInferenceJob({
    jobId: input.jobId,
    deviceId: device.id,
    result: input.result ? { ...input.result } : null,
    error: input.error ?? null,
    now: new Date().toISOString(),
  });
}

export async function listActiveRelayProviders(input: {
  organizationId: string;
  userId: string;
  origin: string;
}): Promise<LocalSubscriptionProvider[]> {
  if (!isRelayDbConfigured()) return [];
  const devices = await getRelayDb().listFreshLocalConnectorDevices({
    organizationId: input.organizationId,
    userId: input.userId,
    origin: input.origin,
    seenAfter: new Date(Date.now() - DEVICE_FRESH_MS).toISOString(),
  });
  const providers = new Set<LocalSubscriptionProvider>();
  for (const device of devices) {
    for (const provider of device.providers) {
      if (provider === "openai" || provider === "anthropic") providers.add(provider);
    }
  }
  return [...providers];
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Local inference aborted."));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Local inference aborted."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createRelayCliRunner(input: {
  organizationId: string;
  userId: string;
  origin: string;
}): LocalCliRunner {
  return async (invocation: LocalCliInvocation) => {
    const db = getRelayDb();
    const devices = await db.listFreshLocalConnectorDevices({
      organizationId: input.organizationId,
      userId: input.userId,
      origin: input.origin,
      seenAfter: new Date(Date.now() - DEVICE_FRESH_MS).toISOString(),
      limit: 10,
    });
    // The provider predicate runs in TypeScript on the small fresh-device set:
    // `providers` is jsonb, and PostgREST's `.contains()` serialization is
    // rejected by the jsonb operator ("invalid input syntax for type json").
    const device = devices.find((candidate) =>
      candidate.providers.includes(invocation.provider)
    );
    if (!device) throw new Error("The paired Ciele Connector is offline.");
    const expiresAt = Date.now() + JOB_TTL_MS;
    const jobs = db.table("localInferenceJobs");
    const job = await jobs.insert({
      deviceId: device.id,
      organizationId: input.organizationId,
      userId: input.userId,
      provider: invocation.provider,
      // "" = no explicit model: the connector falls back to its default model
      // (the column is non-null; the wire shape still reads as falsy).
      modelId: invocation.modelId ?? "",
      invocation: {
        prompt: invocation.prompt,
        responseSchema: invocation.responseSchema ?? null,
        requireAdvertisedModel: invocation.requireAdvertisedModel === true,
      },
      expiresAt: new Date(expiresAt).toISOString(),
    });
    try {
      while (Date.now() < expiresAt) {
        if (invocation.signal?.aborted) {
          throw invocation.signal.reason ?? new Error("Local inference aborted.");
        }
        const current = await jobs.get(job.id);
        if (!current) {
          throw new Error("Local inference job disappeared before completion.");
        }
        if (current.status === "completed") {
          return current.result as unknown as LocalCliResult;
        }
        if (current.status === "failed") {
          throw new Error(current.error || "Local provider inference failed.");
        }
        await wait(POLL_MS, invocation.signal);
      }
      throw new Error("The local provider did not answer before the timeout.");
    } finally {
      await jobs.delete(job.id);
    }
  };
}
