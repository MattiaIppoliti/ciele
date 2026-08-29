export type ConnectorProvider = "openai" | "anthropic";
export type ConnectorFollowUpBehavior = "queue" | "steer";

/** Browser-local preview routing shared by Settings and the Preview composer. */
const PREVIEW_AI_PREFERENCES_KEY_PREFIX = "ciele.preview.ai-preferences";

export function previewAiPreferencesKey(scope: string): string {
  if (!/^[a-f0-9]{64}$/.test(scope)) {
    throw new Error("Invalid preview preference scope.");
  }
  return `${PREVIEW_AI_PREFERENCES_KEY_PREFIX}.${scope}`;
}

/** Stable loopback discovery port used by the generic desktop packages. */
export const CONNECTOR_BOOTSTRAP_PORT = 49_321;
export const CURRENT_CONNECTOR_VERSION = "0.3.7";

export function connectorNeedsUpgrade(version: string): boolean {
  const parse = (value: string) => {
    const match = value.match(/^(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : null;
  };
  const current = parse(CURRENT_CONNECTOR_VERSION)!;
  const candidate = parse(version);
  if (!candidate) return true;
  for (let index = 0; index < current.length; index += 1) {
    if (candidate[index] !== current[index]) {
      return candidate[index] < current[index];
    }
  }
  return false;
}

export interface ConnectorPairing {
  port: number;
  token: string;
  scope: string;
}

export interface ConnectorProviderStatus {
  provider: ConnectorProvider;
  label: string;
  available: boolean;
  connected: boolean;
  connecting: boolean;
  accountLabel?: string;
  plan?: string;
  error?: string;
  models?: ConnectorModel[];
  usage?: ConnectorUsage;
  tokenUsage?: ConnectorTokenUsage;
  usageUnavailableReason?: string;
}

export interface ConnectorTokenUsage {
  inputTokens: number;
  outputTokens: number;
  updatedAt?: number;
}

export interface ConnectorModel {
  id: string;
  label: string;
  inputModalities: Array<"text" | "image">;
}

export interface ConnectorUsageWindow {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: number;
}

export interface ConnectorUsage {
  windows: ConnectorUsageWindow[];
}

export interface ConnectorPreferences {
  defaultModel: string;
  followUpBehavior: ConnectorFollowUpBehavior;
}

export interface ConnectorStatus {
  version: string;
  providers: ConnectorProviderStatus[];
  preferences: ConnectorPreferences;
  relayConnected?: boolean;
}

export const DEFAULT_CONNECTOR_PREFERENCES: ConnectorPreferences = {
  defaultModel: "automatic",
  followUpBehavior: "queue",
};

/**
 * The single owner of the model-selector grammar. `LOCAL_MODEL_SELECTOR`
 * matches a `local:<provider>:<modelId>` selector with provider + modelId
 * capture groups; the whole-selector `MODEL_SELECTOR` (which also accepts
 * "automatic") is derived from it so the pattern lives in exactly one place.
 */
const LOCAL_MODEL_SELECTOR = /^local:(openai|anthropic):([a-z0-9][a-z0-9._-]{0,99})$/;
const MODEL_SELECTOR = new RegExp(
  `^(automatic|${LOCAL_MODEL_SELECTOR.source.slice(1, -1)})$`
);

function isModelSelector(value: unknown): value is string {
  return typeof value === "string" && MODEL_SELECTOR.test(value);
}

/**
 * Parses a `local:<provider>:<modelId>` selector, or returns null for anything
 * that is not one (including "automatic" and non-strings). The canonical way to
 * read a local model selector, callers must not re-implement the grammar.
 */
export function parseLocalModelSelector(
  value: unknown
): { provider: ConnectorProvider; modelId: string } | null {
  if (typeof value !== "string") return null;
  const match = value.match(LOCAL_MODEL_SELECTOR);
  if (!match) return null;
  return { provider: match[1] as ConnectorProvider, modelId: match[2] };
}

export function sanitizeConnectorPreferences(
  value: unknown
): ConnectorPreferences {
  if (!value || typeof value !== "object") {
    return structuredClone(DEFAULT_CONNECTOR_PREFERENCES);
  }
  const candidate = value as Partial<ConnectorPreferences>;
  if (
    !isModelSelector(candidate.defaultModel) ||
    (candidate.followUpBehavior !== "queue" &&
      candidate.followUpBehavior !== "steer")
  ) {
    return structuredClone(DEFAULT_CONNECTOR_PREFERENCES);
  }
  return {
    defaultModel: candidate.defaultModel,
    followUpBehavior: candidate.followUpBehavior,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clampPercent(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function sanitizeModels(value: unknown): ConnectorModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): ConnectorModel[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const model = candidate as Record<string, unknown>;
    const id = optionalString(model.id);
    const label = optionalString(model.label);
    if (!id || !label || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(id)) return [];
    const inputModalities = Array.isArray(model.inputModalities)
      ? model.inputModalities.filter(
          (item): item is "text" | "image" => item === "text" || item === "image"
        )
      : [];
    return [{ id, label, inputModalities }];
  });
}

function sanitizeUsage(value: unknown): ConnectorUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const windowsValue = (value as { windows?: unknown }).windows;
  if (!Array.isArray(windowsValue)) return undefined;
  const windows = windowsValue.flatMap((candidate): ConnectorUsageWindow[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const window = candidate as Record<string, unknown>;
    const label = optionalString(window.label);
    if (!label) return [];
    const resetsAt =
      typeof window.resetsAt === "number" && Number.isFinite(window.resetsAt)
        ? Math.round(window.resetsAt)
        : undefined;
    return [
      {
        label,
        usedPercent: clampPercent(window.usedPercent),
        remainingPercent: clampPercent(window.remainingPercent),
        ...(resetsAt === undefined ? {} : { resetsAt }),
      },
    ];
  });
  return windows.length > 0 ? { windows } : undefined;
}

function sanitizeTokenUsage(value: unknown): ConnectorTokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const tokenCount = (input: unknown) =>
    typeof input === "number" && Number.isSafeInteger(input) && input >= 0
      ? input
      : 0;
  const inputTokens = tokenCount(candidate.inputTokens);
  const outputTokens = tokenCount(candidate.outputTokens);
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  const updatedAt =
    typeof candidate.updatedAt === "number" &&
    Number.isSafeInteger(candidate.updatedAt) &&
    candidate.updatedAt > 0
      ? candidate.updatedAt
      : undefined;
  return {
    inputTokens,
    outputTokens,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

/** Treat the loopback connector as untrusted input before rendering it. */
export function sanitizeConnectorStatus(value: unknown): ConnectorStatus {
  const candidate =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const providers = Array.isArray(candidate.providers)
    ? candidate.providers.flatMap((item): ConnectorProviderStatus[] => {
        if (!item || typeof item !== "object") return [];
        const provider = item as Record<string, unknown>;
        if (provider.provider !== "openai" && provider.provider !== "anthropic") {
          return [];
        }
        return [
          {
            provider: provider.provider,
            label:
              optionalString(provider.label) ??
              (provider.provider === "openai"
                ? "ChatGPT Subscription"
                : "Claude Subscription"),
            available: provider.available === true,
            connected: provider.connected === true,
            connecting: provider.connecting === true,
            accountLabel: optionalString(provider.accountLabel),
            plan: optionalString(provider.plan),
            error: optionalString(provider.error),
            models: sanitizeModels(provider.models),
            usage: sanitizeUsage(provider.usage),
            tokenUsage: sanitizeTokenUsage(provider.tokenUsage),
            usageUnavailableReason: optionalString(provider.usageUnavailableReason),
          },
        ];
      })
    : [];
  return {
    version: optionalString(candidate.version) ?? "unknown",
    providers,
    preferences: sanitizeConnectorPreferences(candidate.preferences),
    relayConnected: candidate.relayConnected === true,
  };
}

export function parseConnectorPairing(fragment: string): ConnectorPairing | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const port = Number(params.get("connectorPort"));
  const token = params.get("connectorToken") ?? "";
  const scope = params.get("connectorScope") ?? "";
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    !/^[A-Za-z0-9_-]{6,256}$/.test(token) ||
    !/^[a-f0-9]{64}$/.test(scope)
  ) {
    return null;
  }
  return { port, token, scope };
}

export function connectorBaseUrl(port: number): string {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Invalid connector port.");
  }
  return `http://127.0.0.1:${port}`;
}
