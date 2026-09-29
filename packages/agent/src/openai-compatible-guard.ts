import { EgressPolicyError, validateEgressTarget } from "./egress";
import { getRuntimeHost } from "./host";

/**
 * Egress policy for an OpenAI-compatible endpoint an Organization typed into
 * the console (docs/audits/api-request-egress-policy.md). The operator's own
 * `OPENAI_COMPATIBLE_*` environment is trusted and never goes through here.
 *
 * Strict by default: HTTPS, no loopback, no private ranges. `next dev` and
 * Vercel preview relax the scheme and loopback rules through the same host
 * port every other tenant-configured request uses.
 */
function policy() {
  const relaxed = getRuntimeHost().allowRelaxedEgress();
  return { allowHttp: relaxed, allowLoopback: relaxed };
}

/** The refusal message for a base URL the policy rejects, or null when it passes. */
export async function checkOpenAiCompatibleBaseUrl(
  baseUrl: string
): Promise<string | null> {
  try {
    await validateEgressTarget(baseUrl, policy());
    return null;
  } catch (error) {
    if (error instanceof EgressPolicyError) return error.message;
    return "Base URL must be a valid http(s) URL";
  }
}

/**
 * `fetch` for `createOpenAICompatible`, validating every request's target
 * immediately before it goes out and refusing redirects. The response streams,
 * which `pinnedRequest` (it buffers the body) cannot do, so the connection is
 * not pinned to the validated address: a DNS answer that changes between the
 * check and the connect is a residual window. Save-time validation plus this
 * per-request check still stops a private or metadata address typed in, and a
 * host that resolves there at either moment.
 */
export const guardedOpenAiCompatibleFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  await validateEgressTarget(url, policy());
  return fetch(input, { ...init, redirect: "error" });
};
