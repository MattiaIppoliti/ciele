import type { ApiRequestAuth, FlowActionSettings, KeyValuePair } from "./types";

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
export function redactFlowSecrets<T extends { actionSettings?: FlowActionSettings }>(
  flow: T
): T {
  const api = flow.actionSettings?.api_request;
  if (!api) return flow;

  const auth = api.auth;
  let redactedAuth = auth;
  if (auth?.type === "bearer") {
    redactedAuth = { type: "bearer", hasToken: Boolean(auth.token) };
  } else if (auth?.type === "api_key") {
    redactedAuth = {
      type: "api_key",
      header: auth.header,
      hasKey: Boolean(auth.key),
    };
  } else if (auth?.type === "basic") {
    redactedAuth = {
      type: "basic",
      username: auth.username,
      hasPassword: Boolean(auth.password),
    };
  }

  const blankValues = (pairs: KeyValuePair[] | undefined) =>
    pairs?.map((pair) => (pair.value ? { ...pair, value: "" } : pair));

  return {
    ...flow,
    actionSettings: {
      ...flow.actionSettings,
      api_request: {
        ...api,
        ...(redactedAuth ? { auth: redactedAuth } : {}),
        ...(api.headers ? { headers: blankValues(api.headers) } : {}),
        ...(api.queryParams
          ? { queryParams: blankValues(api.queryParams) }
          : {}),
      },
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
export function mergeFlowSecrets(
  incoming: FlowActionSettings | undefined,
  stored: FlowActionSettings | undefined
): FlowActionSettings | undefined {
  const next = incoming?.api_request;
  const prev = stored?.api_request;
  if (!next || !prev) return incoming;

  // The `has*` flags are derived on read, so they must not be written back:
  // `redactFlowSecrets` set them on the copy this caller was given, and the
  // caller returns them verbatim. Drop them here, or the stored jsonb starts
  // carrying a stale mirror of whether it carries a secret.
  const auth = next.auth ? withoutHasFlags(next.auth) : next.auth;
  const prevAuth = prev.auth;
  // Only carry a secret across when the auth type is unchanged: a different
  // type means different credentials, and the old one must not survive.
  let mergedAuth = auth;
  if (auth && prevAuth && auth.type === prevAuth.type) {
    if (auth.type === "bearer" && !auth.token && prevAuth.type === "bearer") {
      mergedAuth = { ...auth, token: prevAuth.token };
    } else if (auth.type === "api_key" && !auth.key && prevAuth.type === "api_key") {
      mergedAuth = { ...auth, key: prevAuth.key };
    } else if (
      auth.type === "basic" &&
      !auth.password &&
      prevAuth.type === "basic"
    ) {
      mergedAuth = { ...auth, password: prevAuth.password };
    }
  }

  // A blanked value on a pair whose name still matches keeps its stored value;
  // a renamed or new pair is taken as sent.
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

  return {
    ...incoming,
    api_request: {
      ...next,
      ...(mergedAuth ? { auth: mergedAuth } : {}),
      ...(next.headers
        ? { headers: mergePairs(next.headers, prev.headers) }
        : {}),
      ...(next.queryParams
        ? { queryParams: mergePairs(next.queryParams, prev.queryParams) }
        : {}),
    },
  };
}

/** `redactFlowSecrets` over a list, for the list read paths. */
export function redactFlowsSecrets<T extends { actionSettings?: FlowActionSettings }>(
  flows: T[]
): T[] {
  return flows.map(redactFlowSecrets);
}
