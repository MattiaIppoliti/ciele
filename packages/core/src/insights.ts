import type {
  Assistant,
  BreakdownChart,
  BreakdownSeries,
  ChartAggregate,
  ConversationFilter,
  InboxConversation,
  InsightsChartData,
  InsightsFilter,
  InsightsMessage,
  InsightsOverview,
  InsightsStats,
  OrgWebsiteSource,
} from "./types";

/**
 * Pure Insights KPI computation (see CLAUDE.md §8): filtering + the Overview
 * aggregates, the time-series chart, and the usage breakdowns. This is the
 * oracle for the Insights read model, the in-memory Db adapter composes these
 * functions, and the production SQL function (`get_insights_overview`) mirrors
 * the same contract. No React, no presentation; series carry keys + values
 * only. The parity tests assert the assembled overview equals these pieces.
 */

/** Local-date yyyy-mm-dd (toISOString would shift the day near midnight). */
export function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Hostname without a leading www., or "" when the URL is missing/invalid. */
export function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function yearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Identity for "unique users": profile email if known, else the subject id. */
export function userKey(c: InboxConversation): string {
  return c.metadata.userEmail ?? c.subjectId;
}

/**
 * Whether a Conversation is nothing but proactive Notifications (#546).
 *
 * Such a Conversation is engagement the Assistant initiated and the Visitor never
 * joined, so Insights does not count it as a Conversation, one reply of any kind
 * makes it a real one. A Conversation with no messages at all is not "only"
 * notifications, and keeps whatever treatment it had.
 */
export function isNotificationOnly(
  conversationId: string,
  messages: InsightsMessage[]
): boolean {
  let seen = false;
  for (const message of messages) {
    if (message.conversationId !== conversationId) continue;
    seen = true;
    if (!message.proactive) return false;
  }
  return seen;
}

/**
 * Drops notification-only Conversations before anything else looks at them, which
 * is where the SQL drops them too (`all_conversations`), so total, resolution
 * rate, unique users, the breakdowns and even the role filter options all inherit
 * the rule from one place instead of restating it.
 *
 * The whole message history decides, not the filtered window: a conversation that
 * only ever held a nudge is not engagement in any date range.
 */
export function engagedConversations(
  conversations: InboxConversation[],
  messages: InsightsMessage[]
): InboxConversation[] {
  const proactiveOnly = new Map<string, boolean>();
  for (const message of messages) {
    const previous = proactiveOnly.get(message.conversationId);
    const stillOnly = (previous ?? true) && message.proactive === true;
    proactiveOnly.set(message.conversationId, stillOnly);
  }
  return conversations.filter((c) => !proactiveOnly.get(c.id));
}

/** Applies the conversation-level filters (date range + segment facets). */
export function filterConversations(
  conversations: InboxConversation[],
  filters: ConversationFilter
): InboxConversation[] {
  const from = filters.from ? new Date(`${filters.from}T00:00:00`) : null;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999`) : null;
  return conversations.filter((c) => {
    // Staff (member-subject) conversations, admin Preview, the org-staff
    // data assistant, never distort customer analytics (#668). Mirrors the
    // subject_type condition in the SQL get_insights_overview.
    if (c.subjectType === "member") return false;
    const created = new Date(c.createdAt);
    if (from && created < from) return false;
    if (to && created > to) return false;
    if (filters.assistantId && c.assistantId !== filters.assistantId) return false;
    if (filters.channel && hostOf(c.metadata.launchUrl) !== filters.channel)
      return false;
    if (filters.role && c.metadata.userRole !== filters.role) return false;
    if (filters.feedback === "up" && c.feedback !== 1) return false;
    if (filters.feedback === "down" && c.feedback !== -1) return false;
    if (filters.escalation === "escalated" && !c.metadata.escalated) return false;
    if (filters.escalation === "not_escalated" && c.metadata.escalated)
      return false;
    return true;
  });
}

/** Messages belonging to the filtered conversations, within the date range. */
export function filterMessages(
  messages: InsightsMessage[],
  filtered: InboxConversation[],
  from: string,
  to: string
): InsightsMessage[] {
  const ids = new Set(filtered.map((c) => c.id));
  const fromDate = from ? new Date(`${from}T00:00:00`) : null;
  const toDate = to ? new Date(`${to}T23:59:59.999`) : null;
  return messages.filter((m) => {
    if (!ids.has(m.conversationId)) return false;
    const created = new Date(m.createdAt);
    if (fromDate && created < fromDate) return false;
    if (toDate && created > toDate) return false;
    return true;
  });
}

/**
 * Overview KPI cards from the filtered conversations + messages.
 *
 * `proactiveMessages` is counted separately and deliberately comes from a wider
 * set: a nudge nobody replied to lives in a conversation that is *not* in the
 * population (see `engagedConversations`), so counting notifications out of
 * `filteredMessages` would report zero for exactly the case the KPI exists to
 * show. Absent, it falls back to the notifications inside `filteredMessages`.
 */
export function computeInsightsStats(
  filtered: InboxConversation[],
  filteredMessages: InsightsMessage[],
  proactiveMessages?: InsightsMessage[]
): InsightsStats {
  const total = filtered.length;
  const escalated = filtered.filter((c) => c.metadata.escalated).length;
  const positive = filteredMessages.filter((m) => m.feedback === 1).length;
  const negative = filteredMessages.filter((m) => m.feedback === -1).length;
  // A Notification is not an answer (#546): nobody asked for it. It is reported on
  // its own so turning proactive flows on stays visible without moving answer KPIs.
  const notifications = (proactiveMessages ?? filteredMessages).filter(
    (m) => m.proactive
  ).length;
  const aiAnswers = filteredMessages.filter(
    (m) => m.role === "assistant" && !m.proactive
  ).length;
  const userMessages = filteredMessages.filter((m) => m.role === "user").length;
  const users = new Set(filtered.map(userKey));
  const languages = new Map<string, number>();
  for (const c of filtered) {
    if (!c.metadata.language) continue;
    languages.set(c.metadata.language, (languages.get(c.metadata.language) ?? 0) + 1);
  }
  return {
    total,
    escalated,
    resolutionRate:
      total > 0 ? Math.round(((total - escalated) / total) * 100) : null,
    positive,
    negative,
    answerRating:
      positive + negative > 0
        ? Math.round((positive / (positive + negative)) * 100)
        : 0,
    aiAnswers,
    notifications,
    userMessages,
    uniqueUsers: users.size,
    conversationsPerUser: users.size > 0 ? round1(total / users.size) : 0,
    answersPerConversation: total > 0 ? round1(aiAnswers / total) : 0,
    languages: [...languages].sort((a, b) => b[1] - a[1]),
  };
}

/** Builds the date buckets (labels) for the given range + aggregate. */
function bucketKeys(start: Date, end: Date, aggregate: ChartAggregate): string[] {
  const keys: string[] = [];
  if (aggregate === "daily") {
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1))
      keys.push(isoDay(d));
  } else if (aggregate === "weekly") {
    for (const d = mondayOf(start); d <= end; d.setDate(d.getDate() + 7))
      keys.push(isoDay(d));
  } else {
    for (
      const d = new Date(start.getFullYear(), start.getMonth(), 1);
      d <= end;
      d.setMonth(d.getMonth() + 1)
    )
      keys.push(yearMonth(d));
  }
  return keys;
}

/**
 * Time-series metrics bucketed by day/week/month over the filtered data.
 *
 * `proactiveMessages` widens the Notifications series the same way
 * `computeInsightsStats` widens its KPI: a nudge nobody replied to belongs to a
 * conversation outside the population, and it still happened.
 */
export function computeInsightsChart(
  filtered: InboxConversation[],
  filteredMessages: InsightsMessage[],
  range: { from: string; to: string; aggregate: ChartAggregate },
  proactiveMessages?: InsightsMessage[]
): InsightsChartData {
  const start = new Date(`${range.from}T00:00:00`);
  const end = new Date(`${range.to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return { labels: [], series: [] };
  }

  const keys = bucketKeys(start, end, range.aggregate);
  const index = new Map(keys.map((k, i) => [k, i]));
  const keyOf = (iso: string) => {
    const d = new Date(iso);
    if (range.aggregate === "daily") return isoDay(d);
    if (range.aggregate === "weekly") return isoDay(mondayOf(d));
    return yearMonth(d);
  };
  const zeros = () => new Array<number>(keys.length).fill(0);

  const convCount = zeros();
  const escalations = zeros();
  const aiAnswers = zeros();
  const notifications = zeros();
  const userMessages = zeros();
  const positive = zeros();
  const negative = zeros();
  const users = keys.map(() => new Set<string>());

  for (const c of filtered) {
    const i = index.get(keyOf(c.createdAt));
    if (i === undefined) continue;
    convCount[i] += 1;
    if (c.metadata.escalated) escalations[i] += 1;
    users[i].add(userKey(c));
  }
  for (const m of filteredMessages) {
    const i = index.get(keyOf(m.createdAt));
    if (i === undefined) continue;
    if (m.proactive) {
      // Counted below, from the wider proactive set, skip so it is not doubled.
    } else if (m.role === "assistant") aiAnswers[i] += 1;
    else userMessages[i] += 1;
    if (m.feedback === 1) positive[i] += 1;
    if (m.feedback === -1) negative[i] += 1;
  }
  for (const m of proactiveMessages ?? filteredMessages) {
    if (!m.proactive) continue;
    const i = index.get(keyOf(m.createdAt));
    if (i === undefined) continue;
    notifications[i] += 1;
  }

  const values: Record<string, number[]> = {
    Conversations: convCount,
    Escalation: escalations,
    "AI answers": aiAnswers,
    Notifications: notifications,
    "User messages": userMessages,
    "Unique users": users.map((s) => s.size),
    "Conversations / User": users.map((s, i) =>
      s.size > 0 ? round1(convCount[i] / s.size) : 0
    ),
    "Answers / Conversation": convCount.map((c, i) =>
      c > 0 ? round1(aiAnswers[i] / c) : 0
    ),
    "Messages / Conversation": convCount.map((c, i) =>
      c > 0 ? round1((aiAnswers[i] + userMessages[i]) / c) : 0
    ),
    "Resolution rate": convCount.map((c, i) =>
      c > 0 ? Math.round(((c - escalations[i]) / c) * 100) : 0
    ),
    "Shortcut click": zeros(),
    "Answer rating": positive.map((p, i) =>
      p + negative[i] > 0 ? Math.round((p / (p + negative[i])) * 100) : 0
    ),
    "Positive vote": positive,
    "Negative vote": negative,
  };

  return {
    labels: keys,
    series: Object.entries(values).map(([key, vals]) => ({ key, values: vals })),
  };
}

const BREAKDOWN_PALETTE = ["#3b82f6", "#f59e0b", "#10b981", "#a855f7", "#ec4899"];
const BREAKDOWN_OTHER_COLOR = "#6b7280";
const BREAKDOWN_OTHER_KEY = "__other__";

/**
 * Buckets conversation counts by day/week/month, stacked by an arbitrary
 * dimension (assistant, channel, …), same bucketing as
 * `computeInsightsChart` so the two charts share an x-axis. Groups beyond
 * `maxGroups` (ranked by total volume) fold into "Other".
 */
export function computeBreakdown(
  filtered: InboxConversation[],
  range: { from: string; to: string; aggregate: ChartAggregate },
  groupOf: (c: InboxConversation) => string,
  labelOf: (key: string) => string,
  maxGroups = 5
): BreakdownChart {
  const start = new Date(`${range.from}T00:00:00`);
  const end = new Date(`${range.to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return { labels: [], series: [] };
  }

  const keys = bucketKeys(start, end, range.aggregate);
  const index = new Map(keys.map((k, i) => [k, i]));
  const keyOf = (iso: string) => {
    const d = new Date(iso);
    if (range.aggregate === "daily") return isoDay(d);
    if (range.aggregate === "weekly") return isoDay(mondayOf(d));
    return yearMonth(d);
  };

  const totalsByGroup = new Map<string, number>();
  for (const c of filtered) {
    const g = groupOf(c) || "Unknown";
    totalsByGroup.set(g, (totalsByGroup.get(g) ?? 0) + 1);
  }
  // Rank by volume desc, ties broken by key asc, matches the production SQL
  // (`row_number() over (order by count(*) desc, key)`); see PRD #270.
  const ranked = [...totalsByGroup.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  );
  const top = new Set(ranked.slice(0, maxGroups).map(([g]) => g));
  const hasOther = ranked.length > maxGroups;
  const groupKeys = [...top, ...(hasOther ? [BREAKDOWN_OTHER_KEY] : [])];

  const valuesByGroup = new Map(
    groupKeys.map((g) => [g, new Array<number>(keys.length).fill(0)])
  );
  for (const c of filtered) {
    const raw = groupOf(c) || "Unknown";
    const bucket = valuesByGroup.get(top.has(raw) ? raw : BREAKDOWN_OTHER_KEY);
    if (!bucket) continue;
    const i = index.get(keyOf(c.createdAt));
    if (i !== undefined) bucket[i] += 1;
  }

  const grandTotal = filtered.length || 1;
  const series: BreakdownSeries[] = groupKeys.map((g, i) => {
    const values = valuesByGroup.get(g)!;
    const total = values.reduce((a, b) => a + b, 0);
    return {
      key: g,
      label: g === BREAKDOWN_OTHER_KEY ? "Other" : labelOf(g),
      color:
        g === BREAKDOWN_OTHER_KEY
          ? BREAKDOWN_OTHER_COLOR
          : BREAKDOWN_PALETTE[i % BREAKDOWN_PALETTE.length],
      values,
      total,
      // Integer percent to match the production SQL read model
      // (get_insights_overview rounds to whole percent); see PRD #270 / ADR-0010.
      percent: Math.round((total / grandTotal) * 100),
    };
  });
  // Order by total desc, ties by key asc, mirrors the SQL series ordering
  // (`order by g.total desc, g.key`). "Other" is not special-cased: it sorts
  // by the same rule, as in production. Color stays gray via its key regardless
  // of position.
  series.sort(
    (a, b) => b.total - a.total || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );

  return { labels: keys, series };
}

/**
 * Assembles the full Insights Overview from raw org rows, the in-memory
 * oracle behind `Db.getInsightsOverview`. The production SQL function returns
 * the same shape (minus breakdown colors, reapplied by `colorizeOverview`).
 */
export function computeInsightsOverview(
  conversations: InboxConversation[],
  messages: InsightsMessage[],
  assistants: Pick<Assistant, "id" | "title">[],
  channels: OrgWebsiteSource[],
  filters: InsightsFilter
): InsightsOverview {
  // #546: a Conversation the Visitor never joined is not a Conversation here.
  // Applied first, so every aggregate below, including the role options, sees
  // the same population the SQL does.
  const engaged = engagedConversations(conversations, messages);
  const filtered = filterConversations(engaged, filters);
  const filteredMessages = filterMessages(messages, filtered, filters.from, filters.to);
  // Delivered nudges are counted over the same window but *without* the
  // engagement rule, a nudge nobody answered still went out, and reporting zero
  // for it would defeat the KPI's whole purpose.
  const proactiveMessages = filterMessages(
    messages,
    filterConversations(conversations, filters),
    filters.from,
    filters.to
  );
  const assistantTitleById = new Map(assistants.map((a) => [a.id, a.title]));
  const channelNameByHost = new Map<string, string>();
  for (const channel of channels) {
    const host = hostOf(channel.url);
    if (host && !channelNameByHost.has(host)) channelNameByHost.set(host, channel.name);
  }
  const range = { from: filters.from, to: filters.to, aggregate: filters.aggregate };
  const channelOptions = channels
    .filter((channel) => !filters.assistantId || channel.assistantId === filters.assistantId)
    .reduce((map, channel) => {
      const host = hostOf(channel.url);
      if (host && !map.has(host)) map.set(host, `${channel.name} (${host})`);
      return map;
    }, new Map<string, string>());

  return {
    stats: computeInsightsStats(filtered, filteredMessages, proactiveMessages),
    chart: computeInsightsChart(filtered, filteredMessages, range, proactiveMessages),
    assistantBreakdown: computeBreakdown(
      filtered,
      range,
      (conversation) => conversation.assistantId,
      (id) => assistantTitleById.get(id) ?? id
    ),
    channelBreakdown: computeBreakdown(
      filtered,
      range,
      (conversation) => hostOf(conversation.metadata.launchUrl) || "direct",
      (host) => (host === "direct" ? "Direct" : channelNameByHost.get(host) ?? host)
    ),
    options: {
      roles: [
        ...new Set(
          engaged
            .map((conversation) => conversation.metadata.userRole)
            .filter((role): role is string => !!role)
        ),
      ].sort(),
      channels: [...channelOptions].map(([value, label]) => ({ value, label })),
    },
  };
}

/**
 * Reapplies breakdown colors after a transport (the SQL read model) that
 * cannot carry them: palette by rank, gray for the folded "Other" group.
 */
export function colorizeOverview(overview: InsightsOverview): InsightsOverview {
  const colorize = (breakdown: BreakdownChart): BreakdownChart => ({
    ...breakdown,
    series: breakdown.series.map((series, index) => ({
      ...series,
      color:
        series.key === BREAKDOWN_OTHER_KEY
          ? BREAKDOWN_OTHER_COLOR
          : BREAKDOWN_PALETTE[index % BREAKDOWN_PALETTE.length],
    })),
  });
  return {
    ...overview,
    assistantBreakdown: colorize(overview.assistantBreakdown),
    channelBreakdown: colorize(overview.channelBreakdown),
  };
}
