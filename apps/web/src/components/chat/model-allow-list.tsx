"use client";

import type { ModelRef, Provider } from "@agent-hub/core";
import { sameModel } from "@agent-hub/core";
import { MODEL_CATALOG, PROVIDER_NAMES } from "@agent-hub/agent/client";
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
 */
export function ModelAllowList({
  configured,
  value,
  onChange,
  disabled = false,
  unavailable = [],
}: {
  configured: ModelRef;
  value: ModelRef[];
  onChange: (next: ModelRef[]) => void;
  disabled?: boolean;
  /** Providers the Organization has no credential for (`providersWithoutCredential`). */
  unavailable?: Provider[];
}) {
  const providers = (Object.keys(PROVIDER_NAMES) as Provider[]).filter(
    (provider) => MODEL_CATALOG[provider].length > 0
  );
  const optionKeys = new Set(
    providers.flatMap((provider) =>
      MODEL_CATALOG[provider].map((model) => modelKey({ provider, modelId: model.id }))
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
      <SelectTrigger aria-label="Models visitors may choose" className="w-full max-w-xl">
        <SelectValue>
          {additionalCount === 0
            ? "Choose models for visitors"
            : `${additionalCount} additional ${additionalCount === 1 ? "model" : "models"} selected`}
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
            {MODEL_CATALOG[provider].map((model) => {
              const ref: ModelRef = { provider, modelId: model.id };
              const isConfigured = sameModel(ref, configured);
              return (
                <SelectItem
                  key={model.id}
                  value={modelKey(ref)}
                  disabled={isConfigured}
                  className={cn(
                    isConfigured || unavailable.includes(provider)
                      ? "text-muted-foreground"
                      : "",
                  )}
                >
                  {model.label}{isConfigured ? " (configured)" : ""}
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

function modelKey(ref: ModelRef): string {
  return `${ref.provider}\u0000${ref.modelId}`;
}

function modelFromKey(key: string): ModelRef {
  const separator = key.indexOf("\u0000");
  return {
    provider: key.slice(0, separator) as Provider,
    modelId: key.slice(separator + 1),
  };
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
