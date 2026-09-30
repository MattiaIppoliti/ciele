import { describe, expect, it, vi } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { Db } from "@agent-hub/db";
import { FIND_KIND_INFO, FIND_KINDS } from "./find-kinds";
import {
  DETAIL_READERS,
  PER_KIND,
  readFindDetail,
  readFindRecords,
  readPageStats,
  type FindReadContext,
} from "./find-reads";

function context(over: Partial<FindReadContext> = {}): FindReadContext {
  return {
    db: getMockDb(),
    organizationId: DEMO_ORG.id,
    organizationName: DEMO_ORG.name,
    role: "owner",
    userId: DEMO_MEMBER.userId,
    listTeammates: async () => [],
    insights: async () => null,
    listApiKeys: async () => [],
    log: () => {},
    ...over,
  };
}

/** A Db whose named reads reject, everything else the real mock. */
function failing(...names: string[]): Db {
  const real = getMockDb();
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && names.includes(prop)) {
        return () => Promise.reject(new Error(`${prop} failed`));
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe("readFindRecords", () => {
  it("reads every kind into flat records whose key is `${kind}:${id}`", async () => {
    const { records } = await readFindRecords(context());
    const kinds = new Set(records.map((r) => r.kind));
    expect(kinds.has("assistant")).toBe(true);
    expect(kinds.has("help_desk")).toBe(true);
    for (const r of records) expect(r.key).toBe(`${r.kind}:${r.id}`);
  });

  it("opens a conversation through the Inbox deep link, which is a real route", async () => {
    const { records } = await readFindRecords(context());
    const conversations = records.filter((r) => r.kind === "conversation");
    expect(conversations.length).toBeGreaterThan(0);
    for (const c of conversations) expect(c.href).toBe(`/inbox?conversation=${c.id}`);
  });

  it("bounds what it reads and hands back at most PER_KIND per kind, newest first", async () => {
    const { records } = await readFindRecords(context());
    const assistants = records.filter((r) => r.kind === "assistant");
    expect(assistants.length).toBeLessThanOrEqual(PER_KIND);
    const times = assistants.map((r) => Date.parse(r.updatedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("loses only the kind whose read failed, and says so instead of showing it empty", async () => {
    const log = vi.fn();
    const { records, partial } = await readFindRecords(context({ db: failing("listHelpDesks"), log }));
    expect(partial).toBe(true);
    expect(records.some((r) => r.kind === "assistant")).toBe(true);
    expect(records.some((r) => r.kind === "help_desk")).toBe(false);
    expect(log).toHaveBeenCalledWith("help_desks", expect.any(Error));
  });

  it("does not wait forever on a read that never answers", async () => {
    const real = getMockDb();
    const hung = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "listHelpDesks") return () => new Promise(() => {});
        return Reflect.get(target, prop, receiver);
      },
    });
    const { records, partial } = await readFindRecords(context({ db: hung, timeoutMs: 30 }));
    expect(partial).toBe(true);
    expect(records.some((r) => r.kind === "help_desk")).toBe(false);
    expect(records.some((r) => r.kind === "assistant")).toBe(true);
  });
});

describe("readFindDetail", () => {
  it("has a reader for exactly the kinds the kinds table says have a detail", () => {
    expect(Object.keys(DETAIL_READERS).sort()).toEqual(
      FIND_KINDS.filter((kind) => FIND_KIND_INFO[kind].detail).sort()
    );
  });

  it("returns null for a record in another Organization", async () => {
    const { records } = await readFindRecords(context());
    const assistant = records.find((r) => r.kind === "assistant")!;
    const other = context({ organizationId: "some-other-org" });
    expect(await readFindDetail(other, "assistant", assistant.id)).toBeNull();
    const desk = records.find((r) => r.kind === "help_desk")!;
    expect(await readFindDetail(other, "help_desk", desk.id)).toBeNull();
  });

  it("returns null for a conversation whose assistant is in another Organization", async () => {
    const { records } = await readFindRecords(context());
    const conversation = records.find((r) => r.kind === "conversation")!;
    const other = context({ organizationId: "some-other-org" });
    expect(await readFindDetail(other, "conversation", conversation.id)).toBeNull();
  });

  it("gives every named item a place to open", async () => {
    const { records } = await readFindRecords(context());
    const assistant = records.find((r) => r.kind === "assistant")!;
    const detail = await readFindDetail(context(), "assistant", assistant.id);
    for (const item of detail!.items) {
      expect(item.href).toMatch(new RegExp(`^/assistants/${assistant.id}/knowledge\\?c=`));
    }
    const desk = records.find((r) => r.kind === "help_desk")!;
    const channels = await readFindDetail(context(), "help_desk", desk.id);
    for (const item of channels!.items) expect(item.href).toBe(`/help-desks/${desk.id}`);

    const library = await readPageStats(context(), "/library");
    for (const item of library!.items) expect(item.href).toMatch(/^\/assistants\/[^/]+\/knowledge\?c=/);
  });

  it("reads a conversation's opening question and latest answer as messages", async () => {
    const { records } = await readFindRecords(context());
    const conversation = records.find((r) => r.kind === "conversation")!;
    const detail = await readFindDetail(context(), "conversation", conversation.id);
    expect(detail).not.toBeNull();
    expect(detail!.messages.length).toBeGreaterThan(0);
    expect(detail!.messages[0]!.role).toBe("user");
  });
});

describe("readPageStats", () => {
  it("counts flows the way the flows page does", async () => {
    const ctx = context();
    const assistants = await ctx.db.listAssistants(DEMO_ORG.id);
    const flows = (await Promise.all(assistants.slice(0, 8).map((a) => ctx.db.listFlows(a.id)))).flat();
    const stats = await readPageStats(ctx, "/setup/flows");
    const row = stats!.stats.find((s) => s.label === "Flows")!;
    expect(row.value).toBe(`${flows.filter((f) => f.enabled).length} of ${flows.length} enabled`);
  });

  it("scopes a SETUP section opened from an assistant to that assistant alone", async () => {
    const ctx = context();
    const [first] = await ctx.db.listAssistants(DEMO_ORG.id);
    const flows = await ctx.db.listFlows(first!.id);
    const stats = await readPageStats(ctx, `/assistants/${first!.id}/flows`);
    const row = stats!.stats.find((s) => s.label === "Flows")!;
    expect(row.value).toBe(`${flows.filter((f) => f.enabled).length} of ${flows.length} enabled`);
  });

  it("leaves a stat out when its read fails rather than reporting zero", async () => {
    const log = vi.fn();
    const stats = await readPageStats(context({ db: failing("listMembers"), log }), "/settings/general");
    expect(stats!.stats.map((s) => s.label)).not.toContain("Members");
    expect(stats!.stats.map((s) => s.label)).toContain("Organization");
    expect(log).toHaveBeenCalledWith("members", expect.any(Error));
  });

  it("counts API keys only when the keys operation answers for this Member", async () => {
    const owner = await readPageStats(context({ listApiKeys: async () => [] }), "/settings/general");
    const refused = await readPageStats(context({ listApiKeys: async () => null }), "/settings/general");
    expect(owner!.stats.map((s) => s.label)).toContain("API keys");
    expect(refused!.stats.map((s) => s.label)).not.toContain("API keys");
    expect(refused!.partial).toBeUndefined();
  });

  it("leaves a count out when any read it adds up over fails, rather than undercounting", async () => {
    const flows = await readPageStats(context({ db: failing("listFlows") }), "/setup/flows");
    expect(flows!.stats.map((s) => s.label)).not.toContain("Flows");
    expect(flows!.partial).toBe(true);

    const knowledge = await readPageStats(context({ db: failing("listSources") }), "/setup/knowledge");
    expect(knowledge!.stats.map((s) => s.label)).toContain("Collections");
    expect(knowledge!.stats.map((s) => s.label)).not.toContain("Sources");

    const collections = await readPageStats(context({ db: failing("listCollections") }), "/library");
    expect(collections!.stats.map((s) => s.label)).not.toContain("Collections");
    expect(collections!.stats.map((s) => s.label)).not.toContain("Sources");

    const skills = await readPageStats(context({ db: failing("getApiIntegration") }), "/setup/tools");
    expect(skills!.stats.map((s) => s.label)).toContain("Skills");
    expect(skills!.stats.map((s) => s.label)).not.toContain("API integrations");
  });

  it("prints no count at all when the assistants it would add up over could not be listed", async () => {
    for (const href of ["/setup/flows", "/setup/knowledge", "/setup/tools", "/setup/goals", "/setup/publish"]) {
      const stats = await readPageStats(context({ db: failing("listAssistantsPage") }), href);
      expect(stats!.stats).toEqual([]);
      expect(stats!.partial).toBe(true);
    }
  });

  it("counts publications that were all read, even after the scoped assistant needed a second read", async () => {
    const ctx = context();
    const [first] = await ctx.db.listAssistants(DEMO_ORG.id);
    const stats = await readPageStats(
      context({ db: failing("listAssistantsPage") }),
      `/assistants/${first!.id}/publish`
    );
    expect(stats!.stats.map((s) => s.label)).toContain("Published");
  });

  it("says a source count is a floor when it did not count every collection", async () => {
    const ctx = context();
    const assistants = await ctx.db.listAssistants(DEMO_ORG.id);
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, name: `C${i}` }));
    const db = new Proxy(ctx.db, {
      get: (target, prop, receiver) =>
        prop === "listCollections"
          ? async (id: string) => (id === assistants[0]!.id ? many : [])
          : prop === "listSources"
            ? async () => [{ id: "s" }]
            : Reflect.get(target, prop, receiver),
    });
    const stats = await readPageStats(context({ db }), "/library");
    expect(stats!.stats.find((s) => s.label === "Sources")!.value).toBe("12+");
  });

  it("does not call an assistant a draft when its publication read failed", async () => {
    const stats = await readPageStats(context({ db: failing("getLatestPublication") }), "/setup/publish");
    expect(stats!.stats.map((s) => s.label)).not.toContain("Published");
    for (const link of stats!.links) expect(link.title).not.toMatch(/\(draft\)$/);
  });

  it("returns null for a page with nothing live", async () => {
    expect(await readPageStats(context(), "/improvements")).toBeNull();
    expect(await readPageStats(context(), "/somewhere/new")).toBeNull();
  });
});

describe("degraded reads are reported, not disguised", () => {
  it("marks a complete list as not partial", async () => {
    const { partial } = await readFindRecords(context());
    expect(partial).toBe(false);
  });

  it("throws when the row's own read fails, instead of answering 'nothing there'", async () => {
    const ctx = context({ db: failing("getAssistant") });
    const { records } = await readFindRecords(context());
    const assistant = records.find((r) => r.kind === "assistant")!;
    await expect(readFindDetail(ctx, "assistant", assistant.id)).rejects.toThrow();
  });

  it("marks a detail whose secondary read failed as partial", async () => {
    const { records } = await readFindRecords(context());
    const assistant = records.find((r) => r.kind === "assistant")!;
    const detail = await readFindDetail(context({ db: failing("listFlows") }), "assistant", assistant.id);
    expect(detail).not.toBeNull();
    expect(detail!.partial).toBe(true);
    const whole = await readFindDetail(context(), "assistant", assistant.id);
    expect(whole!.partial).toBeUndefined();
  });

  it("marks page stats with a failed piece as partial", async () => {
    const stats = await readPageStats(context({ db: failing("listMembers") }), "/settings/general");
    expect(stats!.partial).toBe(true);
    const whole = await readPageStats(context(), "/settings/general");
    expect(whole!.partial).toBeUndefined();
  });

  it("dates a run in a way that does not depend on the server's locale", async () => {
    const ctx = context();
    const stats = await readPageStats(ctx, "/eval");
    const latest = stats?.stats.find((s) => s.label === "Latest run");
    if (latest) expect(latest.value).toMatch(/· \d{4}-\d{2}-\d{2}$/);
  });
});
