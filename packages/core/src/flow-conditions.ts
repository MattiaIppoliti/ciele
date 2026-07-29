import type { Flow, FlowCondition } from "./types";

/**
 * Objective Flow Conditions — the deterministic half of the Conditions step
 * (spec #550).
 *
 * `url` and `schedule` are checkable facts, so they are *checked*: this module
 * gates them before Intent Classification, in the one place both engines funnel
 * through to pick their candidates (`messageFlowCandidates`). Handing a boolean
 * to a model turns it into a judgement and produces bugs that reproduce
 * intermittently; the semantic `conversation_context` condition stays with the
 * classifier, which is what a judgement call is for.
 *
 * Everything here is pure. The clock and the page URL arrive as a
 * `FlowRoutingContext` — nothing reads `Date.now()` or a global, so any instant
 * is testable and the package stays I/O-free.
 */

/** The facts objective conditions are evaluated against. */
export interface FlowRoutingContext {
  /**
   * The page the Visitor is on — the Conversation's launch URL. Absent for
   * surfaces that cannot report one (an unwired host, the editor Preview).
   */
  url?: string;
  /** The instant to evaluate schedules at. Absent leaves them unevaluatable. */
  now?: Date;
}

/**
 * Longest regular expression a URL condition may carry. The only ReDoS
 * mitigation here beyond compiling inside a try/catch — a linear-time engine or
 * an evaluation timeout is a follow-up if user-authored patterns turn out to be
 * a real exposure.
 */
export const FLOW_URL_PATTERN_LIMIT = 500;

/** Why a condition cannot be evaluated. The editor maps these to its copy. */
export type FlowConditionDefect =
  | "url_value_missing"
  | "url_pattern_too_long"
  | "url_regex_invalid"
  | "schedule_start_missing"
  | "schedule_start_invalid"
  | "schedule_end_invalid"
  | "schedule_end_before_start";

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Normalizes a stored wall-clock bound to `YYYY-MM-DDTHH:mm`, or null when it
 * is not one. Tolerates the seconds and the space separator that a hand-written
 * row or a future API might carry; `<input type="datetime-local">` writes
 * neither.
 */
function wallClock(value: string | undefined): string | null {
  const normalized = (value ?? "").trim().replace(" ", "T").slice(0, 16);
  return WALL_CLOCK.test(normalized) ? normalized : null;
}

/**
 * `now` as a wall-clock string in `timezone`, comparable to a stored bound by
 * plain string ordering (both are zero-padded and in the same order).
 *
 * Comparing wall-clock to wall-clock is what makes a schedule survive a DST
 * change without any offset arithmetic. An unknown zone id falls back to the
 * host zone rather than throwing — the same fail-soft choice
 * `channelAvailabilityNow` makes.
 */
function wallClockInZone(now: Date, timezone: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = () =>
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (!timezone.trim()) return local();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const year = get("year");
    const month = get("month");
    const day = get("day");
    // "24" can come back at midnight with hour12: false.
    const hour = pad(Number(get("hour")) % 24);
    const minute = get("minute");
    if (!year || !month || !day || !minute) return local();
    return `${year}-${month}-${day}T${hour}:${minute}`;
  } catch {
    return local();
  }
}

/**
 * Whether this condition is gated deterministically (`url`, `schedule`) rather
 * than judged semantically (`conversation_context`).
 */
export function isObjectiveFlowCondition(condition: FlowCondition): boolean {
  return condition.kind === "url" || condition.kind === "schedule";
}

/**
 * What stops this condition from being evaluated, or null when it is complete.
 *
 * The editor refuses to save a defective condition, so a defect in stored data
 * means a row written before this feature or through a future API. Those are
 * **ignored** by the gate rather than failing closed: a mis-stored condition
 * must never silently switch a live Flow off.
 */
export function flowConditionDefect(
  condition: FlowCondition
): FlowConditionDefect | null {
  if (condition.kind === "url") {
    const value = condition.value.trim();
    if (!value) return "url_value_missing";
    if (value.length > FLOW_URL_PATTERN_LIMIT) return "url_pattern_too_long";
    if (condition.operator === "regex") {
      try {
        new RegExp(value);
      } catch {
        return "url_regex_invalid";
      }
    }
    return null;
  }
  if (condition.kind === "schedule") {
    if (!(condition.startAt ?? "").trim()) return "schedule_start_missing";
    const start = wallClock(condition.startAt);
    if (!start) return "schedule_start_invalid";
    const rawEnd = (condition.endAt ?? "").trim();
    if (!rawEnd) return null;
    const end = wallClock(condition.endAt);
    if (!end) return "schedule_end_invalid";
    if (end <= start) return "schedule_end_before_start";
    return null;
  }
  return null;
}

/**
 * Evaluates one objective condition against the routing context.
 *
 * Returns null — "no verdict" — for a semantic condition, a defective one, or
 * one whose input the context does not carry. A null verdict never disqualifies
 * a Flow.
 */
export function evaluateFlowCondition(
  condition: FlowCondition,
  context: FlowRoutingContext
): boolean | null {
  if (!isObjectiveFlowCondition(condition)) return null;
  if (flowConditionDefect(condition) !== null) return null;

  if (condition.kind === "url") {
    const url = context.url;
    if (!url) return null;
    const value = condition.value.trim();
    switch (condition.operator) {
      case "matches":
        return url === value;
      case "contains":
        return url.includes(value);
      case "regex":
        try {
          return new RegExp(value).test(url);
        } catch {
          return null;
        }
    }
  }

  if (condition.kind === "schedule") {
    const now = context.now;
    if (!now) return null;
    const start = wallClock(condition.startAt);
    if (!start) return null;
    const local = wallClockInZone(now, condition.timezone);
    if (local < start) return false;
    const end = wallClock(condition.endAt);
    // End is exclusive; a blank or unparseable end leaves the window open.
    return end ? local < end : true;
  }

  return null;
}

/**
 * Whether a Flow's objective conditions leave it eligible to be routed to.
 *
 * The rule is "cannot pass", not "does pass":
 *
 * - **all** — every objective verdict must be true; one false disqualifies.
 * - **any** — disqualified only when *every* condition on the Flow produced a
 *   verdict and all of them are false. A semantic condition (or an
 *   unevaluatable one) can still satisfy `any`, so it keeps the Flow eligible.
 *
 * A satisfied objective condition is therefore **necessary, not sufficient**: it
 * never promotes a Flow to "matched" on its own. Being on `/courses` makes a
 * Flow eligible; whether it is *the* answer stays with the classifier and with
 * Flow priority order.
 */
export function flowConditionsAllowRouting(
  flow: Flow,
  context: FlowRoutingContext = {}
): boolean {
  const conditions = flow.conditions ?? [];
  const verdicts: boolean[] = [];
  for (const condition of conditions) {
    const verdict = evaluateFlowCondition(condition, context);
    if (verdict !== null) verdicts.push(verdict);
  }
  if (verdicts.length === 0) return true;
  if ((flow.conditionLogic ?? "any") === "all") return verdicts.every(Boolean);
  // Any: something without a verdict may still satisfy the logic downstream.
  return verdicts.some(Boolean) || verdicts.length < conditions.length;
}
