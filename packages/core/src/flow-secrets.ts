import type { ApiRequestAuth, FlowActionSettings, KeyValuePair, WebhookCall } from "./types";

/** Strips the read-only `has*` flags, which are derived and never persisted. */
function withoutHasFlags(auth: ApiRequestAuth): ApiRequestAuth {
  if (auth.type === "bearer") {
    const { hasToken: _hasToken, ...rest } = auth;
    return rest;
  }
  if (auth.type === "api_key") {
    const { hasKey: _hasKey, ...rest } = auth;
    return rest;
  }
  if (auth.type === "basic") {
    const { hasPassword: _hasPassword, ...rest } = auth;
    return rest;
  }
  return auth;
}

/**
 * Strips the outbound credentials a Flow's `api_request` action carries, so a
 * read surface can serve the router config without serving the secrets in it.
 *
 * Why this exists: `flows.action_settings` is plain jsonb, and the `api_request`
 * action's bearer token / api-key value / basic password live in it in
 * cleartext. Every read of a Flow was returning them verbatim, which put a
 * tenant's real outbound credentials in front of any caller that could read a
 * Flow at all: a Viewer-role member, a Viewer-role API key, a read-only MCP
 * agent. This is the projection that `packages/ops/src/help-desks.ts`'s
 * `publicSupportChannel` already applies to the identical class of field.
 *
 * `hasToken` / `hasKey` / `hasPassword` replace the values so an editor can
 * still show "configured" without receiving the secret. They are derived here
 * and never persisted; `mergeFlowSecrets` is the write-side twin that puts the
 * stored value back when a patch comes in without one.
 *
 * Header and query-param VALUES go too: the channel editor's free-form pairs are
 * where an operator puts a credential the typed `auth` field has no slot for.
 */
function redactAuth(auth: ApiRequestAuth | undefined): ApiRequestAuth | undefined {
  if (auth?.type === "bearer") {
    return { type: "bearer", hasToken: Boolean(auth.token) };
  }
  if (auth?.type === "api_key") {
    return { type: "api_key", header: auth.header, hasKey: Boolean(auth.key) };
  }
  if (auth?.type === "basic") {
    return { type: "basic", username: auth.username, hasPassword: Boolean(auth.password) };
  }
  return auth;
}

const blankValues = (pairs: KeyValuePair[] | undefined) =>
  pairs?.map((pair) => (pair.value ? { ...pair, value: "" } : pair));

/** One webhook call (#842) with its credential and header values removed. */
function redactWebhookCall(call: WebhookCall | undefined): WebhookCall | undefined {
  if (!call) return call;
  const redactedAuth = redactAuth(call.auth);
  return {
    ...call,
    ...(redactedAuth ? { auth: redactedAuth } : {}),
    ...(call.headers ? { headers: blankValues(call.headers) } : {}),
  };
}

export function redactFlowSecrets<T extends { actionSettings?: FlowActionSettings }>(
  flow: T
): T {
  const api = flow.actionSettings?.api_request;
  const webhook = flow.actionSettings?.http_webhook;
  if (!api && !webhook) return flow;

  const redactedAuth = redactAuth(api?.auth);

  return {
    ...flow,
    actionSettings: {
      ...flow.actionSettings,
      ...(api
        ? {
            api_request: {
              ...api,
              ...(redactedAuth ? { auth: redactedAuth } : {}),
              ...(api.headers ? { headers: blankValues(api.headers) } : {}),
              ...(api.queryParams ? { queryParams: blankValues(api.queryParams) } : {}),
            },
          }
        : {}),
      // The webhook's two calls carry the same slots for the same reason: a
      // subscribe call to a system that wants a key must be able to send one
      // without the key ending up in the URL, the snapshot and the transcript.
      ...(webhook
        ? {
            http_webhook: {
              ...webhook,
              ...(webhook.subscribe ? { subscribe: redactWebhookCall(webhook.subscribe) } : {}),
              ...(webhook.unsubscribe
                ? { unsubscribe: redactWebhookCall(webhook.unsubscribe) }
                : {}),
            },
          }
        : {}),
    },
  };
}

/**
 * Puts the stored `api_request` secrets back into an incoming patch that arrived
 * without them, which is what makes `redactFlowSecrets` safe to apply to the
 * editor's own read: the Flow Builder round-trips the settings blob it was
 * given, so without this a save would blank the credential it never received.
 *
 * A caller that means to *change* a secret sends the new value and it wins; a
 * caller that means to *clear* one switches the auth type.
 */
/**
 * The stored credential put back behind an incoming one that arrived blank.
 * The `has*` flags are derived on read, so they must not be written back:
 * `redactFlowSecrets` set them on the copy this caller was given, and the
 * caller returns them verbatim. Drop them here, or the stored jsonb starts
 * carrying a stale mirror of whether it carries a secret. Only carry a secret
 * across when the auth type is unchanged: a different type means different
 * credentials, and the old one must not survive.
 */
function mergeAuth(
  incoming: ApiRequestAuth | undefined,
  prevAuth: ApiRequestAuth | undefined
): ApiRequestAuth | undefined {
  const auth = incoming ? withoutHasFlags(incoming) : incoming;
  if (!auth || !prevAuth || auth.type !== prevAuth.type) return auth;
  if (auth.type === "bearer" && !auth.token && prevAuth.type === "bearer") {
    return { ...auth, token: prevAuth.token };
  }
  if (auth.type === "api_key" && !auth.key && prevAuth.type === "api_key") {
    return { ...auth, key: prevAuth.key };
  }
  if (auth.type === "basic" && !auth.password && prevAuth.type === "basic") {
    return { ...auth, password: prevAuth.password };
  }
  return auth;
}

/**
 * A blanked value on a pair whose name still matches keeps its stored value;
 * a renamed or new pair is taken as sent.
 */
const mergePairs = (
  incomingPairs: KeyValuePair[] | undefined,
  storedPairs: KeyValuePair[] | undefined
) =>
  incomingPairs?.map((pair) =>
    pair.value
      ? pair
      : {
          ...pair,
          value: storedPairs?.find((p) => p.name === pair.name)?.value ?? "",
        }
  );

function mergeWebhookCall(
  next: WebhookCall | undefined,
  prev: WebhookCall | undefined
): WebhookCall | undefined {
  if (!next || !prev) return next;
  const mergedAuth = mergeAuth(next.auth, prev.auth);
  return {
    ...next,
    ...(mergedAuth ? { auth: mergedAuth } : {}),
    ...(next.headers ? { headers: mergePairs(next.headers, prev.headers) } : {}),
  };
}

export function mergeFlowSecrets(
  incoming: FlowActionSettings | undefined,
  stored: FlowActionSettings | undefined
): FlowActionSettings | undefined {
  if (!incoming) return incoming;
  let merged: FlowActionSettings = incoming;

  const next = incoming.api_request;
  const prev = stored?.api_request;
  if (next && prev) {
    const mergedAuth = mergeAuth(next.auth, prev.auth);
    merged = {
      ...merged,
      api_request: {
        ...next,
        ...(mergedAuth ? { auth: mergedAuth } : {}),
        ...(next.headers ? { headers: mergePairs(next.headers, prev.headers) } : {}),
        ...(next.queryParams
          ? { queryParams: mergePairs(next.queryParams, prev.queryParams) }
          : {}),
      },
    };
  }

  const nextWebhook = incoming.http_webhook;
  const prevWebhook = stored?.http_webhook;
  if (nextWebhook && prevWebhook) {
    const subscribe = mergeWebhookCall(nextWebhook.subscribe, prevWebhook.subscribe);
    const unsubscribe = mergeWebhookCall(nextWebhook.unsubscribe, prevWebhook.unsubscribe);
    merged = {
      ...merged,
      http_webhook: {
        ...nextWebhook,
        ...(subscribe ? { subscribe } : {}),
        ...(unsubscribe ? { unsubscribe } : {}),
      },
    };
  }

  return merged;
}

/** `redactFlowSecrets` over a list, for the list read paths. */
export function redactFlowsSecrets<T extends { actionSettings?: FlowActionSettings }>(
  flows: T[]
): T[] {
  return flows.map(redactFlowSecrets);
}
