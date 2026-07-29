import { describe, expect, it } from "vitest";
import {
  colorizeOverview,
  computeBreakdown,
  computeInsightsChart,
  computeInsightsOverview,
  computeInsightsStats,
  engagedConversations,
  filterConversations,
  filterMessages,
  hostOf,
  isNotificationOnly,
} from "./insights";
import {
  ASSISTANTS,
  CHANNELS,
  conv,
  fixtureConversations,
  fixtureMessages,
  FILTER_CASES,
  msg,
  NO_FILTER,
} from "./testing/insights-fixtures";
import type { InsightsFilter } from "./types";

/**
 * Insights read model: the pure KPI functions — the oracle at the KPI seam
 * (CLAUDE.md §8) — and the parity between them and the assembled Overview.
 *
 * The two *adapter* halves of the same contract are asserted where the adapters
 * live, against these fixtures: the in-memory Db in
 * `packages/db/src/insights-adapter.test.ts`, and the production SQL function
 * `get_insights_overview` in `packages/db/src/testing/insights.parity.test.ts`.
 */

describe("hostOf", () => {
  it("strips protocol and www, tolerates junk", () => {
    expect(hostOf("https://www.example.com/x")).toBe("example.com");
    expect(hostOf("http://portal.uni.it")).toBe("portal.uni.it");
    expect(hostOf(undefined)).toBe("");
    expect(hostOf("not a url")).toBe("");
  });
});

describe("filterConversations", () => {
  const a = conv({ id: "a", assistantId: "a1", createdAt: "2026-06-10T09:00:00Z" });
  const b = conv({ id: "b", assistantId: "a2", createdAt: "2026-06-20T09:00:00Z" });
  const escalated = conv({ id: "e", metadata: { escalated: true } });
  const all = [a, b, escalated];

  it("passes everything through with an empty filter", () => {
    expect(filterConversations(all, NO_FILTER)).toHaveLength(3);
  });

  it("filters by inclusive local date range", () => {
    const res = filterConversations(all, {
      ...NO_FILTER,
      from: "2026-06-15",
      to: "2026-06-25",
    });
    expect(res.map((c) => c.id)).toEqual(["b", "e"]);
  });

  it("filters by assistant and escalation facets", () => {
    expect(
      filterConversations(all, { ...NO_FILTER, assistantId: "a2" }).map((c) => c.id)
    ).toEqual(["b"]);
    expect(
      filterConversations(all, { ...NO_FILTER, escalation: "escalated" }).map(
        (c) => c.id
      )
    ).toEqual(["e"]);
    expect(
      filterConversations(all, { ...NO_FILTER, escalation: "not_escalated" }).map(
        (c) => c.id
      )
    ).toEqual(["a", "b"]);
  });

  it("filters by launch-url hostname (channel)", () => {
    const fromSite = conv({
      id: "s",
      metadata: { launchUrl: "https://www.campus.edu/help" },
    });
    const res = filterConversations([a, fromSite], {
      ...NO_FILTER,
      channel: "campus.edu",
    });
    expect(res.map((c) => c.id)).toEqual(["s"]);
  });
});

describe("filterMessages", () => {
  it("keeps only messages of the filtered conversations within range", () => {
    const filtered = [conv({ id: "keep" })];
    const messages = [
      msg({ conversationId: "keep", createdAt: "2026-06-15T00:00:00Z" }),
      msg({ conversationId: "dropped" }),
      msg({ conversationId: "keep", createdAt: "2020-01-01T00:00:00Z" }),
    ];
    const res = filterMessages(messages, filtered, "2026-06-01", "2026-06-30");
    expect(res).toHaveLength(1);
  });
});

describe("computeInsightsStats", () => {
  it("computes resolution rate, answer rating, and per-user ratios", () => {
    const convs = [
      conv({ subjectId: "u1", metadata: { language: "en" } }),
      conv({ subjectId: "u1", metadata: { escalated: true, language: "en" } }),
      conv({ subjectId: "u2", metadata: { language: "it" } }),
      conv({ subjectId: "u2" }),
    ];
    const messages = [
      msg({ role: "assistant", feedback: 1 }),
      msg({ role: "assistant", feedback: -1 }),
      msg({ role: "assistant", feedback: 1 }),
      msg({ role: "user" }),
    ];
    const stats = computeInsightsStats(convs, messages);
    expect(stats.total).toBe(4);
    expect(stats.escalated).toBe(1);
    expect(stats.resolutionRate).toBe(75); // (4-1)/4
    expect(stats.uniqueUsers).toBe(2);
    expect(stats.conversationsPerUser).toBe(2);
    expect(stats.aiAnswers).toBe(3);
    expect(stats.userMessages).toBe(1);
    expect(stats.answersPerConversation).toBe(0.8); // 3/4 → round1
    expect(stats.positive).toBe(2);
    expect(stats.negative).toBe(1);
    expect(stats.answerRating).toBe(67); // 2/3
    expect(stats.languages).toEqual([
      ["en", 2],
      ["it", 1],
    ]);
  });

  it("returns null resolutionRate and zeroed ratios for empty input", () => {
    const stats = computeInsightsStats([], []);
    expect(stats.resolutionRate).toBeNull();
    expect(stats.answerRating).toBe(0);
    expect(stats.conversationsPerUser).toBe(0);
  });
});

describe("computeInsightsChart", () => {
  it("buckets daily and aligns metric arrays with labels", () => {
    const convs = [
      conv({ id: "x", subjectId: "u1", createdAt: "2026-06-01T10:00:00Z" }),
      conv({
        id: "y",
        subjectId: "u2",
        createdAt: "2026-06-03T10:00:00Z",
        metadata: { escalated: true },
      }),
    ];
    const messages = [
      msg({ conversationId: "x", role: "assistant", createdAt: "2026-06-01T10:00:00Z" }),
      msg({ conversationId: "y", role: "user", createdAt: "2026-06-03T10:00:00Z" }),
    ];
    const chart = computeInsightsChart(convs, messages, {
      from: "2026-06-01",
      to: "2026-06-03",
      aggregate: "daily",
    });
    expect(chart.labels).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    const conversations = chart.series.find((s) => s.key === "Conversations")!;
    expect(conversations.values).toEqual([1, 0, 1]);
    const escalation = chart.series.find((s) => s.key === "Escalation")!;
    expect(escalation.values).toEqual([0, 0, 1]);
    // Every series is aligned to the label count.
    for (const s of chart.series) expect(s.values).toHaveLength(3);
  });

  it("returns empty data when the range is invalid or inverted", () => {
    expect(
      computeInsightsChart([], [], { from: "2026-06-30", to: "2026-06-01", aggregate: "daily" })
    ).toEqual({ labels: [], series: [] });
    expect(
      computeInsightsChart([], [], { from: "", to: "", aggregate: "daily" }).labels
    ).toEqual([]);
  });
});

// --- Parity: assembled Overview equals the pure KPI functions ------------

/**
 * The proactive-Notification accounting rules (#546). Each is pinned separately,
 * so changing one later is a deliberate edit rather than a drifting number — and
 * `insights.parity.test.ts` holds the SQL to the same answers.
 */
describe("proactive Notifications in the read model", () => {
  const nudge = (conversationId: string, createdAt = "2026-06-15T12:00:00.000Z") =>
    msg({ conversationId, role: "assistant", proactive: true, createdAt });
  const answer = (conversationId: string, createdAt = "2026-06-15T12:00:00.000Z") =>
    msg({ conversationId, role: "assistant", createdAt });
  const question = (conversationId: string, createdAt = "2026-06-15T12:00:00.000Z") =>
    msg({ conversationId, role: "user", createdAt });

  it("does not count a Notification as an AI answer", () => {
    const c = conv({ id: "cx" });
    const stats = computeInsightsStats(
      [c],
      [nudge("cx"), question("cx"), answer("cx")]
    );
    expect(stats.aiAnswers).toBe(1);
    expect(stats.notifications).toBe(1);
    expect(stats.userMessages).toBe(1);
    // One answer to one conversation — the nudge does not inflate the ratio.
    expect(stats.answersPerConversation).toBe(1);
  });

  it("recognises a conversation that never got past the nudge", () => {
    expect(isNotificationOnly("cx", [nudge("cx")])).toBe(true);
    expect(isNotificationOnly("cx", [nudge("cx"), question("cx")])).toBe(false);
    // Nothing to be "only": an empty conversation keeps its old treatment.
    expect(isNotificationOnly("cx", [])).toBe(false);
  });

  it("drops notification-only conversations from the population", () => {
    const engaged = conv({ id: "engaged" });
    const nudgedOnly = conv({ id: "nudged" });
    expect(
      engagedConversations(
        [engaged, nudgedOnly],
        [nudge("engaged"), question("engaged"), nudge("nudged")]
      ).map((c) => c.id)
    ).toEqual(["engaged"]);
  });

  it("keeps a notification-only conversation out of the resolution rate", () => {
    const escalated = conv({ id: "c-esc", metadata: { escalated: true } });
    const resolved = conv({ id: "c-ok" });
    const nudgedOnly = conv({ id: "c-nudge" });
    const messages = [
      question("c-esc"),
      answer("c-esc"),
      question("c-ok"),
      answer("c-ok"),
      nudge("c-nudge"),
    ];

    const population = engagedConversations(
      [escalated, resolved, nudgedOnly],
      messages
    );
    const stats = computeInsightsStats(population, messages);
    // 2 real conversations, 1 escalated → 50%. Counting the nudge would read 67%.
    expect(stats.total).toBe(2);
    expect(stats.resolutionRate).toBe(50);
  });

  it("still counts a nudge nobody replied to", () => {
    // The case the KPI exists for. Its conversation is out of the population, so
    // counting notifications from the population's messages would report zero —
    // which is exactly what the first implementation did.
    const nudgedOnly = conv({ id: "c-nudge" });
    const engaged = conv({ id: "c-real" });
    const all = [nudge("c-nudge"), question("c-real"), answer("c-real")];
    const population = engagedConversations([nudgedOnly, engaged], all);
    const populationMessages = all.filter((m) => m.conversationId === "c-real");

    const stats = computeInsightsStats(population, populationMessages, all);
    expect(stats.total).toBe(1);
    expect(stats.notifications).toBe(1);

    const chart = computeInsightsChart(
      population,
      populationMessages,
      { from: "2026-06-15", to: "2026-06-15", aggregate: "daily" },
      all
    );
    expect(
      chart.series.find((s) => s.key === "Notifications")?.values
    ).toEqual([1]);
  });

  it("charts Notifications as their own series", () => {
    const c = conv({ id: "cx", createdAt: "2026-06-15T12:00:00.000Z" });
    const chart = computeInsightsChart(
      [c],
      [nudge("cx"), question("cx"), answer("cx")],
      { from: "2026-06-15", to: "2026-06-15", aggregate: "daily" }
    );
    const series = new Map(chart.series.map((s) => [s.key, s.values]));
    expect(series.get("Notifications")).toEqual([1]);
    expect(series.get("AI answers")).toEqual([1]);
  });
});

describe("computeInsightsOverview parity with pure KPI functions", () => {
  const conversations = fixtureConversations();
  const messages = fixtureMessages(conversations);

  it.each(FILTER_CASES)(
    "routes through the oracle for filter %#",
    (filters) => {
      const overview = computeInsightsOverview(
        conversations,
        messages,
        ASSISTANTS,
        CHANNELS,
        filters
      );
      // Same first step the oracle takes: notification-only conversations are
      // out of the population before any filter runs (#546).
      const filtered = filterConversations(
        engagedConversations(conversations, messages),
        filters
      );
      const filteredMessages = filterMessages(
        messages,
        filtered,
        filters.from,
        filters.to
      );
      // Delivered nudges are counted without the engagement rule (#546).
      const proactiveMessages = filterMessages(
        messages,
        filterConversations(conversations, filters),
        filters.from,
        filters.to
      );
      const range = { from: filters.from, to: filters.to, aggregate: filters.aggregate };

      expect(overview.stats).toEqual(
        computeInsightsStats(filtered, filteredMessages, proactiveMessages)
      );
      expect(overview.chart).toEqual(
        computeInsightsChart(filtered, filteredMessages, range, proactiveMessages)
      );
      const assistantTitle = new Map(ASSISTANTS.map((a) => [a.id, a.title]));
      expect(overview.assistantBreakdown).toEqual(
        computeBreakdown(
          filtered,
          range,
          (c) => c.assistantId,
          (id) => assistantTitle.get(id) ?? id
        )
      );
      // Chart and breakdowns share one x-axis.
      expect(overview.assistantBreakdown.labels).toEqual(overview.chart.labels);
      expect(overview.channelBreakdown.labels).toEqual(overview.chart.labels);
    }
  );

  it("exposes org-wide role and channel filter options regardless of range", () => {
    const overview = computeInsightsOverview(
      conversations,
      messages,
      ASSISTANTS,
      CHANNELS,
      FILTER_CASES[10] // narrow window
    );
    expect(overview.options.roles).toEqual(["staff", "student"]);
    expect(overview.options.channels).toEqual([
      { value: "campus.edu", label: "Campus Portal (campus.edu)" },
      { value: "library.uni.it", label: "Library (library.uni.it)" },
    ]);
  });

  it("scopes channel options to the selected assistant", () => {
    const overview = computeInsightsOverview(conversations, messages, ASSISTANTS, CHANNELS, {
      ...FILTER_CASES[0],
      assistantId: "a1",
    });
    expect(overview.options.channels).toEqual([
      { value: "campus.edu", label: "Campus Portal (campus.edu)" },
    ]);
  });
});

// --- Edge cases -----------------------------------------------------------

describe("computeInsightsOverview edge cases", () => {
  const range: InsightsFilter = {
    from: "2026-06-01",
    to: "2026-06-30",
    aggregate: "daily",
    assistantId: "",
    channel: "",
    role: "",
    feedback: "",
    escalation: "",
  };

  it("returns sane zeros for an empty org", () => {
    const overview = computeInsightsOverview([], [], ASSISTANTS, CHANNELS, range);
    expect(overview.stats.total).toBe(0);
    expect(overview.stats.escalated).toBe(0);
    expect(overview.stats.resolutionRate).toBeNull();
    expect(overview.stats.answerRating).toBe(0);
    expect(overview.stats.uniqueUsers).toBe(0);
    expect(overview.stats.conversationsPerUser).toBe(0);
    expect(overview.stats.answersPerConversation).toBe(0);
    expect(overview.stats.languages).toEqual([]);
    expect(overview.assistantBreakdown.series).toEqual([]);
    expect(overview.channelBreakdown.series).toEqual([]);
    expect(overview.options.roles).toEqual([]);
    // Labels still span the requested range so the chart renders empty, not broken.
    expect(overview.chart.labels).toHaveLength(30);
    for (const s of overview.chart.series) {
      expect(s.values.every((v) => v === 0)).toBe(true);
    }
  });

  it("handles a single conversation", () => {
    const only = conv({
      assistantId: "a1",
      subjectId: "solo",
      createdAt: "2026-06-10T10:00:00.000Z",
      metadata: { userRole: "student", language: "en" },
      feedback: 1,
    });
    const messages = [
      msg({ conversationId: only.id, role: "user", createdAt: only.createdAt }),
      msg({ conversationId: only.id, role: "assistant", feedback: 1, createdAt: only.createdAt }),
    ];
    const overview = computeInsightsOverview([only], messages, ASSISTANTS, CHANNELS, range);
    expect(overview.stats.total).toBe(1);
    expect(overview.stats.resolutionRate).toBe(100);
    expect(overview.stats.uniqueUsers).toBe(1);
    expect(overview.stats.conversationsPerUser).toBe(1);
    expect(overview.stats.aiAnswers).toBe(1);
    expect(overview.stats.answersPerConversation).toBe(1);
    expect(overview.stats.answerRating).toBe(100);
    expect(overview.assistantBreakdown.series).toHaveLength(1);
    expect(overview.assistantBreakdown.series[0]).toMatchObject({
      key: "a1",
      label: "Helper One",
      total: 1,
      percent: 100,
    });
  });
});

// --- colorizeOverview: the SQL transport reapplies breakdown colors -------

describe("colorizeOverview", () => {
  it("reapplies palette colors by rank and gray for Other", () => {
    const overview = computeInsightsOverview(
      fixtureConversations(),
      [],
      ASSISTANTS,
      CHANNELS,
      FILTER_CASES[0]
    );
    // Strip colors as the SQL transport would, then reapply.
    const stripped = {
      ...overview,
      assistantBreakdown: {
        ...overview.assistantBreakdown,
        series: overview.assistantBreakdown.series.map((s) => ({ ...s, color: "" })),
      },
      channelBreakdown: {
        ...overview.channelBreakdown,
        series: overview.channelBreakdown.series.map((s) => ({ ...s, color: "" })),
      },
    };
    expect(colorizeOverview(stripped)).toEqual(overview);
  });
});
