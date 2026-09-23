"use client";

import type { ModelRef, Provider } from "@agent-hub/core";
import { sameModel } from "@agent-hub/core";
import { MODEL_CATALOG, PROVIDER_NAMES } from "@agent-hub/agent/client";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Which models the chat window lets the asker switch to, beside the configured
 * one. Shared by the Assistant's General section and the Teammate's settings,
 * because it is the same decision about two entities.
 *
 * The configured model is shown checked and disabled rather than hidden: it is
 * always in the picker, and a list that silently omitted it would read as "this
 * model is not offered", which is the opposite of true.
 *
 * Nothing here filters by Provider Connection. An admin configuring an
 * Assistant is choosing intent, and a list that hid a model because a
 * credential is momentarily missing would quietly forget the choice on save.
 * Capability is applied where it belongs, at read time, by `chatModelOptions`.
 *
 * It is *said* here, though. A provider with no credential is labelled and its
 * models are marked, because the alternative is what shipped: three boxes
 * ticked, "the chat window offers 3 models" underneath, and a chat window with
 * no picker in it.
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

  function toggle(ref: ModelRef, checked: boolean) {
    onChange(
      checked
        ? [...value, ref]
        : value.filter((entry) => !sameModel(entry, ref))
    );
  }

  return (
    <div className="space-y-4">
      {providers.map((provider) => (
        <div key={provider} className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium">
            {PROVIDER_NAMES[provider]}
            {unavailable.includes(provider) && (
              <span className="font-normal"> · no credential yet</span>
            )}
          </p>
          <div className="space-y-2">
            {MODEL_CATALOG[provider].map((model) => {
              const ref: ModelRef = { provider, modelId: model.id };
              const isConfigured = sameModel(ref, configured);
              const checked =
                isConfigured || value.some((entry) => sameModel(entry, ref));
              return (
                <label
                  key={model.id}
                  className="flex items-center gap-2.5 text-sm"
                >
                  <Checkbox
                    checked={checked}
                    disabled={disabled || isConfigured}
                    onCheckedChange={(next) => toggle(ref, next === true)}
                  />
                  <span
                    className={
                      isConfigured || unavailable.includes(provider)
                        ? "text-muted-foreground"
                        : ""
                    }
                  >
                    {model.label}
                    {isConfigured ? " (configured)" : ""}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * What the picker will actually do, in one sentence, under the list.
 *
 * Counts the configured model, because that is what the asker sees. One means
 * no picker at all, which is worth saying plainly: a checkbox list where every
 * box is clear looks like a broken control rather than a deliberate default.
 *
 * Counts only what the Organization can answer on, for the same reason: a
 * ticked model whose provider has no credential is dropped by
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
