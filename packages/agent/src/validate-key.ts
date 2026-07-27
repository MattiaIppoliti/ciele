import type { Provider } from "@agent-hub/core";

/** Thrown when the provider explicitly rejected the credential. */
export class InvalidProviderKeyError extends Error {
  constructor(provider: Provider) {
    super(`The ${provider} API key was rejected by the provider.`);
    this.name = "InvalidProviderKeyError";
  }
}

interface ProbeRequest {
  url: string;
  headers: Record<string, string>;
  /** Statuses that mean "credential rejected" for this provider. */
  invalidStatuses: number[];
}

const KNOWN_PROVIDERS: Provider[] = ["anthropic", "openai", "google"];

function probeFor(provider: Provider, apiKey: string): ProbeRequest {
  switch (provider) {
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        invalidStatuses: [401, 403],
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/models",
        headers: { authorization: `Bearer ${apiKey}` },
        invalidStatuses: [401, 403],
      };
    case "google":
      // Gemini reports an invalid key as 400 API_KEY_INVALID.
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        headers: {},
        invalidStatuses: [400, 401, 403],
      };
    default:
      // Runtime value from a server action, not guaranteed by the Provider
      // type at the boundary — never silently "pass" an unrecognized value.
      throw new Error(`Unknown provider: ${String(provider)}`);
  }
}

/**
 * Best-effort live check of a BYOK API key with a cheap list-models call.
 * Throws InvalidProviderKeyError only when the provider explicitly rejects
 * the credential; network failures and other statuses pass — validation must
 * never block key entry when the provider is unreachable (e.g. offline dev).
 * An unrecognized `provider` is a caller bug, not a network condition, so it
 * throws unconditionally instead of being swallowed by the network catch.
 */
export async function validateProviderApiKey(
  provider: Provider,
  apiKey: string
): Promise<void> {
  if (!KNOWN_PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider: ${String(provider)}`);
  }
  const probe = probeFor(provider, apiKey);
  let response: Response;
  try {
    response = await fetch(probe.url, {
      headers: probe.headers,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return;
  }
  if (probe.invalidStatuses.includes(response.status)) {
    throw new InvalidProviderKeyError(provider);
  }
}
