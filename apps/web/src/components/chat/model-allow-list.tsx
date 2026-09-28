"use client";

import type { ModelRef, ModelSource, Provider } from "@agent-hub/core";
import { modelSelector, parseModelSelector, sameModel } from "@agent-hub/core";
import {
  MODEL_CATALOG,
  MODEL_SOURCE_NAMES,
  PROVIDER_NAMES,
} from "@agent-hub/agent/client";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { RollingNumber } from "@/components/motion/rolling-number";
import type { ChatCatalog } from "@/lib/platform-model-catalog";

/**
 * Which models the chat window lets the asker switch to, beside the configured
 * one. Shared by the Assistant's General section and the Teammate's settings,
 * because it is the same decision about two entities.
 *
 * The configured model is shown selected and disabled rather than hidden: it
 * is always in the picker, and a selector that silently omitted it would read
 * as "this model is not offered", which is the opposite of true.
 *
 * Nothing here filters by Provider Connection. An admin configuring an
 * Assistant is choosing intent, and a list that hid a model because a
 * credential is momentarily missing would quietly forget the choice on save.
 * Capability is applied where it belongs, at read time, by `chatModelOptions`.
 *
 * It is *said* here, though. A provider with no credential is labelled and its
 * models are marked, because a selected model whose provider has no credential
 * is not offered in the chat window.
 *
 * A model two or more sources can serve also gets one tagged row per source
 * ("Claude Sonnet 5 · AI Gateway") beside its automatic row, so the asker can
 * be offered the same model on two routes.
 */
export function ModelAllowList({
  configured,
  value,
  onChange,
  disabled = false,
  unavailable = [],
  audience = "visitors",
  catalog = MODEL_CATALOG,
  sources = {},
}: {
  configured: ModelRef;
  value: ModelRef[];
  onChange: (next: ModelRef[]) => void;
  disabled?: boolean;
  /** Providers the Organization has no credential for (`providersWithoutCredential`). */
  unavailable?: Provider[];
  /**
   * Who picks from the chat window: an Assistant's visitors, or the colleagues
   * who chat with a Teammate, who are never visitors.
   */
  audience?: "visitors" | "colleagues";
  catalog?: ChatCatalog;
  /** Sources per model, keyed by the automatic selector (`modelSourcesByModel`). */
  sources?: Record<string, ModelSource[]>;
}) {
  const pinnable = (provider: Provider, modelId: string): ModelSource[] => {
    const available = sources[modelSelector({ provider, modelId })] ?? [];
    return available.length >= 2 ? available : [];
  };
  const providers = (Object.keys(PROVIDER_NAMES) as Provider[]).filter(
    (provider) => catalog[provider].length > 0
  );
  const optionKeys = new Set(
    providers.flatMap((provider) =>
      catalog[provider].flatMap((model) => [
        modelKey({ provider, modelId: model.id }),
        ...pinnable(provider, model.id).map((source) =>
          modelKey({ provider, modelId: model.id, source })
        ),
      ])
    )
  );
  const configuredKey = modelKey(configured);
  const selectedKeys = [
    ...new Set([...value.map(modelKey), configuredKey]),
  ];
  const retainedUnknownModels = value.filter((ref) => !optionKeys.has(modelKey(ref)));
  const additionalCount = value.filter((ref) => !sameModel(ref, configured)).length;

  return (
    <Select
      multiple
      value={selectedKeys}
      disabled={disabled}
      onValueChange={(keys) => {
        const selected = keys
          .filter((key) => key !== configuredKey && optionKeys.has(key))
          .map(modelFromKey);
        onChange([...retainedUnknownModels, ...selected]);
      }}
    >
      <SelectTrigger aria-label={`Models ${audience} may choose`} className="w-full max-w-xl">
        <SelectValue>
          {additionalCount === 0 ? (
            `Choose models for ${audience}`
          ) : (
            <>
              <RollingNumber value={additionalCount} /> additional{" "}
              {additionalCount === 1 ? "model" : "models"} selected
            </>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {providers.map((provider) => (
          <SelectGroup
            key={provider}
            aria-label={`${PROVIDER_NAMES[provider]}${unavailable.includes(provider) ? " · no credential yet" : ""}`}
          >
            <SelectGroupLabel>
              {PROVIDER_NAMES[provider]}
              {unavailable.includes(provider) && (
                <span className="font-normal"> · no credential yet</span>
              )}
            </SelectGroupLabel>
            {catalog[provider].flatMap((model) =>
              [undefined, ...pinnable(provider, model.id)].map((source) => {
                const ref: ModelRef = { provider, modelId: model.id, ...(source ? { source } : {}) };
                const isConfigured = sameModel(ref, configured);
                return (
                  <SelectItem
                    key={modelKey(ref)}
                    value={modelKey(ref)}
                    disabled={isConfigured}
                    className={cn(
                      source ? "pl-6" : "",
                      isConfigured || unavailable.includes(provider)
                        ? "text-muted-foreground"
                        : "",
                    )}
                  >
                    {model.label}
                    {source ? ` · ${MODEL_SOURCE_NAMES[source]}` : ""}
                    {isConfigured ? " (configured)" : ""}
                  </SelectItem>
                );
              })
            )}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

const modelKey = modelSelector;

function modelFromKey(key: string): ModelRef {
  // Every key came from `modelKey` over a catalogue row, so it parses.
  return parseModelSelector(key)!;
}

/**
 * What the picker will actually do, in one sentence, below the selector.
 *
 * Counts the configured model, because that is what the asker sees. One means
 * no picker at all, which is worth saying plainly: an empty selector otherwise
 * looks like a broken control rather than a deliberate default.
 *
 * Counts only what the Organization can answer on, for the same reason: a
 * selected model whose provider has no credential is dropped by
 * `chatModelOptions` and never reaches the composer, so counting it here would
 * promise a picker that does not appear.
 */
export function modelAllowListSummary(
  value: ModelRef[],
  unavailable: Provider[] = []
): string {
  const waiting = value.filter((ref) => unavailable.includes(ref.provider));
  const count = value.length - waiting.length + 1;
  const names = listProviders(waiting.map((ref) => ref.provider));
  const held =
    waiting.length === 0
      ? ""
      : ` ${names} ${names.includes(" and ") ? "have" : "has"} no credential yet, so ${
          waiting.length === 1 ? "that model stays" : "those models stay"
        } out of the picker. Add one in Settings → AI.`;
  const picker =
    count < 2
      ? "No picker: everyone runs the configured model."
      : `The chat window offers ${count} models.`;
  return picker + held;
}

/** "Anthropic", "Anthropic and OpenAI", "Anthropic, OpenAI and Google". */
function listProviders(providers: Provider[]): string {
  const names = [...new Set(providers)].map((provider) => PROVIDER_NAMES[provider]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
