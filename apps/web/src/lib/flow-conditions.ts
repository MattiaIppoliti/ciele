import type {
  FlowCondition,
  FlowTrigger,
  FlowUrlOperator,
} from "@agent-hub/core";
import { flowConditionDefect } from "@agent-hub/core";

/**
 * The Flow Builder's Conditions catalog: which condition kinds the picker
 * offers for a given Trigger, how a new one is seeded, and what makes one
 * incomplete (spec #550).
 *
 * Plain TS beside the component on purpose — the web app's vitest only collects
 * `*.test.ts`, so builder logic worth testing lives here rather than in the
 * `.tsx`. The completeness rule is *not* re-implemented: it comes from
 * `flowConditionDefect` in the domain package, the same function the runtime
 * gate uses, so the editor and the runtime cannot disagree about what
 * "configured" means.
 */

/**
 * The condition kinds that exist. Only these — a kind the runtime cannot
 * evaluate is not offered at all, greyed or otherwise: an affordance that never
 * does anything is worse than its absence.
 */
export type FlowConditionKind = FlowCondition["kind"];

export interface FlowConditionKindMeta {
  kind: FlowConditionKind;
  label: string;
  /**
   * Triggers this kind can be configured for. A semantic read of the user's
   * message is meaningless for a page-load Flow, so `conversation_context` is
   * message-only; the objective kinds are trigger-agnostic in themselves.
   *
   * In practice the builder offers no conditions at all for a proactive trigger
   * (#541), so `"all"` is currently only ever consulted for `message` — it says
   * what the kind *can* gate on, not what the editor happens to render today.
   */
  triggers: FlowTrigger[] | "all";
}

const ALL_TRIGGERS = "all" as const;

export const FLOW_CONDITION_KINDS: FlowConditionKindMeta[] = [
  {
    kind: "conversation_context",
    label: "Conversation context",
    triggers: ["message"],
  },
  { kind: "url", label: "URL", triggers: ALL_TRIGGERS },
  { kind: "schedule", label: "Schedule", triggers: ALL_TRIGGERS },
];

/** The picker's chips for a trigger — every one of them addable. */
export function flowConditionPicker(
  trigger: FlowTrigger | null
): FlowConditionKindMeta[] {
  if (trigger === null) return [];
  return FLOW_CONDITION_KINDS.filter(
    (meta) => meta.triggers === ALL_TRIGGERS || meta.triggers.includes(trigger)
  );
}

/** The kinds that can be added for a trigger. */
export function availableFlowConditionKinds(
  trigger: FlowTrigger | null
): FlowConditionKind[] {
  return flowConditionPicker(trigger).map((meta) => meta.kind);
}

export const FLOW_URL_OPERATORS: Array<{
  value: FlowUrlOperator;
  label: string;
  /** Shown under the field — the Matches/Contains difference is where this goes wrong. */
  hint: string;
}> = [
  {
    value: "matches",
    label: "Matches",
    hint: "Triggers only when the entire URL matches exactly, including https:// and any ?query parameters — e.g. https://site.com/courses does not match https://site.com/courses/psychology.",
  },
  {
    value: "contains",
    label: "Contains",
    hint: "Triggers on any page whose URL contains this text, including subpages — e.g. site.com/courses also matches site.com/courses/psychology.",
  },
  {
    value: "regex",
    label: "Regex",
    hint: "Triggers on URLs matching a regular expression — e.g. .*/courses/.* matches any course page.",
  },
];

export function urlOperatorHint(operator: FlowUrlOperator): string {
  return (
    FLOW_URL_OPERATORS.find((o) => o.value === operator)?.hint ??
    FLOW_URL_OPERATORS[0].hint
  );
}

/** The zone a Schedule condition defaults to: the one the admin is sitting in. */
export function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * IANA zone ids for the Schedule selects, labelled with their current GMT
 * offset. Falls back to the admin's own zone on a runtime that cannot enumerate
 * them, so the field is never empty.
 */
export function timezoneOptions(
  now: Date = new Date()
): Array<{ value: string; label: string }> {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  let zones: string[];
  try {
    zones = supported ? supported("timeZone") : [];
  } catch {
    zones = [];
  }
  const fallback = defaultTimezone();
  if (zones.length === 0) zones = [...new Set(["UTC", fallback])];
  return zones.map((value) => ({
    value,
    label: `(${gmtOffsetLabel(value, now)}) ${value.replace(/_/g, " ")}`,
  }));
}

/** e.g. "GMT+2" for Europe/Rome in summer. */
function gmtOffsetLabel(timezone: string, now: Date): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value;
    return name || "GMT";
  } catch {
    return "GMT";
  }
}

/** A blank condition of the requested kind, ready to configure. */
export function newFlowCondition(
  kind: FlowConditionKind,
  id: string,
  timezone: string = defaultTimezone()
): FlowCondition {
  if (kind === "url") {
    return { id, kind: "url", operator: "matches", value: "" };
  }
  if (kind === "schedule") {
    return { id, kind: "schedule", startAt: "", endAt: "", timezone };
  }
  return {
    id,
    kind: "conversation_context",
    description: "",
    examples: [
      { message: "", note: "", shouldTrigger: true },
      { message: "", note: "", shouldTrigger: false },
    ],
  };
}

const DEFECT_MESSAGES: Record<string, string> = {
  url_value_missing: "URL is required",
  url_pattern_too_long: "This URL is too long",
  url_regex_invalid: "Enter a valid regular expression",
  schedule_start_missing: "Start date & time is required",
  schedule_start_invalid: "Enter a valid start date & time",
  schedule_end_invalid: "Enter a valid end date & time",
  schedule_end_before_start: "End must be after start",
};

/**
 * The inline validation message for a condition, or null when it is fine.
 * Derived from the domain package's defect, never from a second rule set.
 */
export function flowConditionIssue(condition: FlowCondition): string | null {
  const defect = flowConditionDefect(condition);
  return defect ? (DEFECT_MESSAGES[defect] ?? "Complete this condition") : null;
}

/** Whether every condition on the flow may be saved. */
export function flowConditionsSavable(conditions: FlowCondition[]): boolean {
  return conditions.every((condition) => flowConditionIssue(condition) === null);
}

/**
 * Save-time cleanup: trim what is free text, drop the example rows the
 * Collaborator left blank, and drop a `conversation_context` condition that
 * ended up carrying nothing. Objective conditions are kept as configured —
 * the save gate has already refused the incomplete ones.
 */
export function cleanFlowConditions(
  conditions: FlowCondition[]
): FlowCondition[] {
  const cleaned: FlowCondition[] = [];
  for (const condition of conditions) {
    if (condition.kind === "conversation_context") {
      const next = {
        ...condition,
        description: condition.description.trim(),
        examples: condition.examples.filter(
          (e) => e.message.trim() || e.note.trim()
        ),
      };
      if (next.description || next.examples.length > 0) cleaned.push(next);
      continue;
    }
    if (condition.kind === "url") {
      cleaned.push({ ...condition, value: condition.value.trim() });
      continue;
    }
    cleaned.push({
      ...condition,
      startAt: condition.startAt.trim(),
      endAt: (condition.endAt ?? "").trim() || undefined,
    });
  }
  return cleaned;
}

/**
 * The flow `description` the classifier catalogs a Flow by: the semantic
 * conditions' descriptions, joined. Objective conditions contribute nothing —
 * they are gated, not prompted.
 */
export function flowConditionDescription(conditions: FlowCondition[]): string {
  return conditions
    .map((condition) =>
      condition.kind === "conversation_context"
        ? condition.description.trim()
        : ""
    )
    .filter(Boolean)
    .join("; ");
}
