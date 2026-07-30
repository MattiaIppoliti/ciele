import type {
  ChannelAvailability,
  ChannelConversationData,
  DayAvailability,
  Flow,
  FlowAction,
  TimeRange,
  WeekDay,
} from "./types";

export interface DefaultFlowSpec {
  name: string;
  description: string;
  builtIn: boolean;
  enabled: boolean;
  actions: FlowAction[];
  customMessage: string;
  isDefault: boolean;
}

/**
 * The name the Basic Interaction built-in Flow ships with. Nothing routes on it
 * — the Flow is identified structurally, by being built-in and carrying the
 * `basic_reply` action, so an admin may rename it freely — but the migration
 * that backfills the Flow and the demo seed both need the same string.
 */
export const BASIC_INTERACTION_FLOW_NAME = "Basic Interaction";

/**
 * The courtesy reply used when nothing better is available: no verbatim message
 * configured *and* no chat model resolves (no Provider Connection). Deliberately
 * generic — it must be true for every assistant, since it is what an
 * unconfigured or offline deployment says to "hello".
 */
export const DEFAULT_BASIC_REPLY =
  "Hi! What would you like to know? Ask me a question and I'll look it up for you.";

/** Flows every new assistant starts with, mirroring the built-in set. */
export const DEFAULT_FLOWS: DefaultFlowSpec[] = [
  {
    // First in priority on purpose: courtesy is the cheapest thing to recognise,
    // and recognising it late means paying for retrieval to answer "hello".
    name: BASIC_INTERACTION_FLOW_NAME,
    description:
      "User is greeting the assistant, thanking it, saying goodbye, or acknowledging a previous answer — conversational courtesy that asks no question and carries no information need",
    builtIn: true,
    enabled: true,
    actions: ["basic_reply"],
    customMessage: "",
    isDefault: false,
  },
  {
    name: "Assistant Information",
    description:
      "User is asking about the assistant's capabilities, features, identity, purpose, or what services it provides",
    builtIn: true,
    enabled: true,
    actions: [],
    customMessage: "",
    isDefault: false,
  },
  {
    name: "Human Help Needed",
    description:
      "User explicitly asks for human help, wants to contact support, escalate to a person, or otherwise reach a human",
    builtIn: true,
    enabled: false,
    actions: [],
    customMessage: "",
    isDefault: false,
  },
  {
    name: "Default behavior",
    description: "No other flow matches the user query",
    builtIn: true,
    enabled: true,
    actions: [],
    customMessage: "",
    isDefault: true,
  },
];

export const DEFAULT_WELCOME_MESSAGE =
  "I can help you with academic information: study plans, academic deadlines, class materials. Tell me: what information would you like to know?";

export const DEFAULT_AI_DISCLAIMER =
  "AI answers are not perfect, so please double-check any critical information.";

export function sortFlows(flows: Flow[]): Flow[] {
  return [...flows].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? 1 : -1;
    return a.position - b.position;
  });
}

export const WEEK_DAYS: WeekDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function defaultDayAvailability(): DayAvailability {
  return { enabled: false, ranges: [] };
}

/** A fresh 09:00–17:00 window, used when a day is first switched on. */
export function defaultTimeRange(id: string): TimeRange {
  return { id, opensHour: 9, opensMinute: 0, closesHour: 17, closesMinute: 0 };
}

export function defaultChannelAvailability(): ChannelAvailability {
  return {
    mode: "always",
    timezone: "UTC",
    hours: Object.fromEntries(
      WEEK_DAYS.map((day) => [day, defaultDayAvailability()])
    ) as ChannelAvailability["hours"],
  };
}

function normalizeTimeRange(raw: unknown, index: number): TimeRange | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.opensHour !== "number" || typeof r.closesHour !== "number") {
    return null;
  }
  return {
    id: typeof r.id === "string" && r.id ? r.id : `r${index}`,
    opensHour: r.opensHour,
    opensMinute: typeof r.opensMinute === "number" ? r.opensMinute : 0,
    closesHour: r.closesHour,
    closesMinute: typeof r.closesMinute === "number" ? r.closesMinute : 0,
  };
}

function normalizeDayAvailability(raw: unknown): DayAvailability {
  if (!raw || typeof raw !== "object") return defaultDayAvailability();
  const d = raw as Record<string, unknown>;
  const enabled = d.enabled === true;
  if (Array.isArray(d.ranges)) {
    return {
      enabled,
      ranges: d.ranges
        .map((r, i) => normalizeTimeRange(r, i))
        .filter((r): r is TimeRange => r !== null),
    };
  }
  // Legacy single-window shape: { opensHour, opensMinute, closesHour, closesMinute }.
  const legacy = normalizeTimeRange({ ...d, id: "r0" }, 0);
  return { enabled, ranges: legacy ? [legacy] : [] };
}

/**
 * Coerce a raw `availability` jsonb value into the current multi-range shape.
 * Tolerates the legacy single-window day shape and the `'{}'` column default,
 * so channels stored before ranges existed still read cleanly.
 */
export function normalizeChannelAvailability(raw: unknown): ChannelAvailability {
  const base = defaultChannelAvailability();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;
  const rawHours = (obj.hours ?? {}) as Record<string, unknown>;
  return {
    mode: obj.mode === "limited" ? "limited" : "always",
    timezone: typeof obj.timezone === "string" ? obj.timezone : base.timezone,
    hours: Object.fromEntries(
      WEEK_DAYS.map((day) => [day, normalizeDayAvailability(rawHours[day])])
    ) as ChannelAvailability["hours"],
  };
}

export function defaultChannelConversationData(): ChannelConversationData {
  return {
    chatSummary: false,
    fullChatHistory: false,
    userData: false,
    metadata: false,
  };
}
