import { describe, expect, it } from "vitest";
import {
  detailRequest,
  EMPTY_FIND_FILTERS,
  filterFindRecords,
  pageContent,
  RECENTS_LIMIT,
  recentsView,
  recencyGroup,
  type FindRecord,
} from "./find-index";

const NOW = new Date(2026, 8, 29, 15, 0, 0); // 29 Sept 2026, 15:00 local

function record(over: Partial<FindRecord> & { key: string }): FindRecord {
  return {
    kind: "assistant",
    id: over.key,
    title: over.key,
    subtitle: "",
    snippet: "",
    href: `/x/${over.key}`,
    updatedAt: NOW.toISOString(),
    facts: [],
    ...over,
  };
}

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("recencyGroup", () => {
  it("puts this morning in Today and yesterday in Past 30 days", () => {
    expect(recencyGroup(new Date(2026, 8, 29, 0, 5).toISOString(), NOW)).toBe("Today");
    expect(recencyGroup(daysAgo(1), NOW)).toBe("Past 30 days");
    expect(recencyGroup(daysAgo(29), NOW)).toBe("Past 30 days");
    expect(recencyGroup(daysAgo(31), NOW)).toBe("Older");
  });

  it("reads an unparseable date as Older instead of throwing", () => {
    expect(recencyGroup("not a date", NOW)).toBe("Older");
  });
});

describe("filterFindRecords", () => {
  const records = [
    record({ key: "a", title: "Support bot", snippet: "answers billing questions", updatedAt: daysAgo(2) }),
    record({ key: "b", title: "Billing", kind: "help_desk", updatedAt: daysAgo(40) }),
    record({ key: "c", title: "Weekly review", kind: "conversation", subtitle: "Support bot", updatedAt: daysAgo(0) }),
  ];

  it("returns everything newest first with no filters", () => {
    expect(filterFindRecords(records, EMPTY_FIND_FILTERS, NOW).map((r) => r.key)).toEqual(["c", "a", "b"]);
  });

  it("searches title, subtitle and snippet, and only the title with Title only", () => {
    const loose = filterFindRecords(records, { ...EMPTY_FIND_FILTERS, query: "billing" }, NOW);
    expect(loose.map((r) => r.key).sort()).toEqual(["a", "b"]);
    const strict = filterFindRecords(
      records,
      { ...EMPTY_FIND_FILTERS, query: "billing", titleOnly: true },
      NOW
    );
    expect(strict.map((r) => r.key)).toEqual(["b"]);
  });

  it("does not let a long snippet match on scattered letters", () => {
    const long = [
      record({ key: "d", title: "Alex", snippet: "answers questions about a CV, portfolio website, and FAQs" }),
    ];
    // "support" is a subsequence of that sentence but not a substring of it.
    expect(filterFindRecords(long, { ...EMPTY_FIND_FILTERS, query: "support" }, NOW)).toEqual([]);
  });

  it("narrows by kind and by how recently a record changed", () => {
    expect(
      filterFindRecords(records, { ...EMPTY_FIND_FILTERS, kind: "help_desk" }, NOW).map((r) => r.key)
    ).toEqual(["b"]);
    expect(
      filterFindRecords(records, { ...EMPTY_FIND_FILTERS, updated: "today" }, NOW).map((r) => r.key)
    ).toEqual(["c"]);
    expect(
      filterFindRecords(records, { ...EMPTY_FIND_FILTERS, updated: "week" }, NOW).map((r) => r.key)
    ).toEqual(["c", "a"]);
  });
});

describe("recency groups over a sorted list", () => {
  it("reads Today, Past 30 days, Older top to bottom, each group one run of rows", () => {
    const sorted = filterFindRecords(
      [
        record({ key: "old", updatedAt: daysAgo(90) }),
        record({ key: "bad", updatedAt: "not a date" }),
        record({ key: "new", updatedAt: NOW.toISOString() }),
        record({ key: "mid", updatedAt: daysAgo(3) }),
      ],
      EMPTY_FIND_FILTERS,
      NOW
    );
    expect(sorted.map((r) => [r.key, recencyGroup(r.updatedAt, NOW)])).toEqual([
      ["new", "Today"],
      ["mid", "Past 30 days"],
      ["old", "Older"],
      ["bad", "Older"],
    ]);
  });
});

describe("pageContent", () => {
  const records = [
    record({ key: "a1", kind: "assistant", title: "Alex", snippet: "Personal assistant" }),
    record({ key: "h1", kind: "help_desk", title: "IT", snippet: "Hardware and access" }),
    record({ key: "a2", kind: "assistant", title: "Ciele", snippet: "" }),
    record({ key: "t1", kind: "teammate", title: "Sam", snippet: "Support copywriter" }),
    record({ key: "c1", kind: "conversation", title: "ciao" }),
    record({ key: "i1", kind: "improvement", title: "Fix tone", status: "to_do" }),
    record({ key: "i2", kind: "improvement", title: "Add FAQ", status: "in_review" }),
    record({ key: "i3", kind: "improvement", title: "Old", status: "archived" }),
  ];

  it("fills card-grid pages with the records they list", () => {
    expect(pageContent("/", records).cards).toEqual([
      { title: "Alex", text: "Personal assistant", href: "/x/a1" },
      { title: "Ciele", text: "", href: "/x/a2" },
    ]);
    expect(pageContent("/help-desks", records).cards).toEqual([
      { title: "IT", text: "Hardware and access", href: "/x/h1" },
    ]);
    expect(pageContent("/teammates", records).cards[0]).toEqual({
      title: "Sam",
      text: "Support copywriter",
      href: "/x/t1",
    });
  });

  it("puts Improvement titles in their kanban lane and drops archived ones", () => {
    const { lanes } = pageContent("/improvements", records);
    expect(lanes.map((l) => [l.label, l.entries.map((e) => e.title)])).toEqual([
      ["To do", ["Fix tone"]],
      ["In progress", ["Add FAQ"]],
      ["Done", []],
    ]);
    // Each entry opens the improvement it names.
    expect(lanes[0]!.entries[0]).toEqual({ title: "Fix tone", href: "/x/i1" });
  });

  it("names the Inbox rows after conversations", () => {
    expect(pageContent("/inbox/conversations", records).rows).toEqual([
      { title: "ciao", href: "/x/c1" },
    ]);
  });

  it("caps the cards at four and leaves other pages empty", () => {
    const many = Array.from({ length: 6 }, (_, i) => record({ key: `a${i}`, kind: "assistant" }));
    expect(pageContent("/", many).cards).toHaveLength(4);
    expect(pageContent("/alerts", records)).toEqual({
      cards: [],
      lanes: [],
      shortcuts: [],
      rows: [],
    });
  });

  it("links a page to its own sub-pages without reading anything", () => {
    const settings = pageContent("/settings/general", records).shortcuts[0]!;
    expect(settings.links.map((l) => l.title)).toContain("Members");
    expect(settings.links.find((l) => l.title === "Members")!.href).toBe("/settings/members");
    expect(pageContent("/insights", records).shortcuts[0]!.links.map((l) => l.href)).toContain(
      "/insights/costs"
    );
    expect(pageContent("/library/websites", records).shortcuts[0]!.links).toHaveLength(3);
  });

  it("offers a SETUP section opened from the picker in each assistant", () => {
    const { shortcuts } = pageContent("/setup/flows", records);
    expect(shortcuts[0]!.label).toBe("Open in");
    expect(shortcuts[0]!.links).toEqual([
      { title: "Alex", href: "/x/a1/flows" },
      { title: "Ciele", href: "/x/a2/flows" },
    ]);
    // A scoped link already is one assistant's page.
    expect(pageContent("/assistants/a1/flows", records).shortcuts).toEqual([]);
  });
});

describe("recentsView", () => {
  const many = Array.from({ length: RECENTS_LIMIT + 8 }, (_, i) =>
    record({ key: `r${i}`, updatedAt: daysAgo(i) })
  );

  it("shows only the most recent few while nothing narrows the search", () => {
    const shown = recentsView(many, EMPTY_FIND_FILTERS);
    expect(shown).toHaveLength(RECENTS_LIMIT);
    expect(shown[0]!.key).toBe("r0");
  });

  it("shows everything the moment there is a query or a filter", () => {
    expect(recentsView(many, { ...EMPTY_FIND_FILTERS, query: "r" })).toHaveLength(many.length);
    expect(recentsView(many, { ...EMPTY_FIND_FILTERS, kind: "assistant" })).toHaveLength(many.length);
    expect(recentsView(many, { ...EMPTY_FIND_FILTERS, updated: "month" })).toHaveLength(many.length);
    expect(recentsView(many, { ...EMPTY_FIND_FILTERS, titleOnly: true })).toHaveLength(many.length);
  });
});

describe("detailRequest", () => {
  const rec = (kind: FindRecord["kind"]) => ({ key: `${kind}:1`, kind, id: "1" });

  it("asks for a record's detail only when its kind has one", () => {
    expect(detailRequest({ record: rec("assistant"), href: "/assistants/1" })).toEqual({
      key: "assistant:1",
      kind: "assistant",
      id: "1",
    });
    expect(detailRequest({ record: rec("improvement"), href: "/improvements/1" })).toBeNull();
  });

  it("asks for a page's numbers only when the page is live", () => {
    expect(detailRequest({ record: null, href: "/eval" })).toEqual({ key: "page:/eval", href: "/eval" });
    expect(detailRequest({ record: null, href: "/improvements" })).toBeNull();
  });
});
