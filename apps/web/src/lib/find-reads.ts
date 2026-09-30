import {
  messageText,
  type Assistant,
  type InsightsOverview,
  type OrgApiKey,
  type Role,
  type Teammate,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { formatPercent } from "@/lib/format";
import {
  describePage,
  FIND_ROUTES,
  type LiveTopic,
  type PageLink,
  type PageTopic,
} from "@/lib/find-pages";
import { FIND_KIND_INFO, type FindKind } from "@/lib/find-kinds";
import type { FindPreviewData, FindRecord, FindRecordsResult } from "@/lib/find-index";

/**
 * What the Find palette reads, behind the one place that decides how.
 *
 * The workload is read-mostly and small: a Member opens the palette, looks at a
 * handful of rows, moves on. So the reads are shaped for that. Assistants,
 * improvements and the inbox are read a page at a time; the rest have no paged
 * read in the Db and are short per Organization, so they are read whole and
 * cut here. The kinds are independent, so one slow or failed read costs its
 * own rows and nothing else. Every read has a deadline after which the answer
 * goes out without it; the read itself is not cancelled (the Db takes no
 * signal) and runs to completion unobserved. The per-row detail is read only
 * for the row being looked at.
 *
 * The record of truth is the Db, read through the session's own RLS-scoped
 * handle, so the palette can only ever show what a Member can already open.
 * Everything here is derived state, thrown away and rebuilt on demand; how long
 * it may be reused is the browser store's decision (`find-store.ts`), not this
 * module's.
 *
 * Framework-free and injected: it takes a `Db` and a few callbacks, never
 * imports the session or the cache, so it runs in node against the mock Db.
 */

export interface FindReadContext {
  db: Db;
  organizationId: string;
  organizationName: string;
  role: Role | null;
  userId: string;
  /** The teammates this Member may see. Goes through its operation, which owns that rule. */
  listTeammates: () => Promise<Teammate[]>;
  /**
   * The Organization's API keys, or null when this Member may not see them.
   * Goes through its operation, which owns that rule.
   */
  listApiKeys: () => Promise<OrgApiKey[] | null>;
  /** The Insights overview for the default window, from the app's shared cache. */
  insights: () => Promise<InsightsOverview | null>;
  /** Where a failed read is reported. Defaults to the server log. */
  log?: (scope: string, error: unknown) => void;
  /** Deadline for any one read, ms. Default 3000. */
  timeoutMs?: number;
}

/**
 * Most rows of one kind the palette carries: it is a recents list, not an export.
 * Small on purpose: every row is read, sent, filtered and scanned, and the ones
 * past the first thirty of a kind are almost never what someone is looking for.
 */
export const PER_KIND = 30;
/** Assistants a page-level read adds up over. */
const SCOPE_CAP = 8;
/** Collections whose sources are counted. */
const SOURCE_COLLECTION_CAP = 12;

const DEFAULT_TIMEOUT_MS = 3000;

function clip(text: string, max = 100): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function newest<T extends { updatedAt: string }>(rows: readonly T[]): T[] {
  return [...rows]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, PER_KIND);
}

const words = (text: string) => text.replace(/_/g, " ");

type Read<T> = PromiseLike<T> | (() => PromiseLike<T>);

/**
 * The reads behind one answer, and whether any of them failed. Made once per
 * answer, so "partial" is that answer's own fact rather than a counter kept on
 * a shared context.
 */
export type Reader = ReturnType<typeof createReader>;

export function createReader(ctx: FindReadContext) {
  const report = ctx.log ?? ((s, e) => console.error(`[find] ${s} read failed`, e));
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let failed = false;

  async function attempt<T>(scope: string, read: Read<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const promise = Promise.resolve(typeof read === "function" ? read() : read);
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      return { ok: true, value: await Promise.race([promise, deadline]) };
    } catch (error) {
      failed = true;
      report(scope, error);
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /**
     * Await a read under the deadline. Resolves to the value, or to `undefined`
     * if it failed or ran out of time, and says so through `log`. Callers leave
     * the piece out on `undefined`: a read that failed must not surface as "0"
     * or "empty", which is indistinguishable from the truth.
     */
    async settle<T>(scope: string, read: Read<T>): Promise<T | undefined> {
      const result = await attempt(scope, read);
      return result.ok ? result.value : undefined;
    },
    /**
     * Several reads a single figure adds up over: every value, or `undefined`
     * when any of them failed, because a sum over what happened to answer is an
     * undercount that looks like a fact.
     */
    async every<T>(scope: string, reads: Array<Read<T>>): Promise<T[] | undefined> {
      const results = await Promise.all(reads.map((read) => attempt(scope, read)));
      const values: T[] = [];
      for (const result of results) {
        if (!result.ok) return undefined;
        values.push(result.value);
      }
      return values;
    },
    /**
     * `settle` for the read a whole answer stands on (the row itself). If that
     * one fails there is nothing honest to say, so this throws and the failure
     * travels up as a failure, which nothing caches, instead of "not found".
     */
    async must<T>(scope: string, read: Read<T>): Promise<T> {
      const result = await attempt(scope, read);
      if (!result.ok) throw new Error(`${scope} read failed`);
      return result.value;
    },
    /** Whether any read so far failed. */
    get partial(): boolean {
      return failed;
    },
    /** Marks an answer partial when any read behind it failed. */
    finish(data: FindPreviewData): FindPreviewData {
      return failed ? { ...data, partial: true } : data;
    },
  };
}

/* ────────────────────────────── the record list ────────────────────────────── */

const href = (kind: FindKind, id: string) => FIND_KIND_INFO[kind].href(id);

/**
 * Each kind's list read and its rows, one entry per kind. Keyed by `FindKind`,
 * so a kind added to `find-kinds.ts` without a list read is a compile error
 * rather than a kind that silently never appears. A failed read leaves its
 * kind out and marks the answer partial (see `Reader.settle`).
 */
const RECORD_READERS: Record<FindKind, (ctx: FindReadContext, r: Reader) => Promise<FindRecord[]>> = {
  assistant: async ({ db, organizationId }, r) => {
    const page = await r.settle("assistants", db.listAssistantsPage(organizationId, { limit: PER_KIND }));
    return newest(page?.items ?? []).map((a): FindRecord => ({
      key: `assistant:${a.id}`,
      id: a.id,
      kind: "assistant",
      title: a.title,
      subtitle: a.nickname,
      snippet: clip(a.description),
      href: href("assistant", a.id),
      updatedAt: a.updatedAt,
      facts: [
        { label: "Nickname", value: a.nickname },
        { label: "ID", value: a.id },
      ],
    }));
  },
  improvement: async ({ db, organizationId }, r) => {
    const page = await r.settle("improvements", db.listImprovementsPage(organizationId, { limit: PER_KIND }));
    return newest(page?.items ?? []).map((i): FindRecord => ({
      key: `improvement:${i.id}`,
      id: i.id,
      kind: "improvement",
      status: i.status,
      title: i.title,
      subtitle: `IMP-${i.seq} · ${words(i.status)}`,
      snippet: clip(i.description),
      href: href("improvement", i.id),
      updatedAt: i.updatedAt,
      facts: [
        { label: "Status", value: words(i.status) },
        { label: "Priority", value: i.priority ?? "none" },
        ...(i.dueDate ? [{ label: "Due", value: i.dueDate }] : []),
        ...(i.tags.length > 0 ? [{ label: "Tags", value: i.tags.join(", ") }] : []),
        { label: "Flagged answers", value: String(i.messageCount) },
      ],
    }));
  },
  help_desk: async ({ db, organizationId }, r) => {
    const desks = await r.settle("help_desks", () => db.listHelpDesks(organizationId));
    return newest(desks ?? []).map((h): FindRecord => ({
      key: `help_desk:${h.id}`,
      id: h.id,
      kind: "help_desk",
      title: h.name,
      subtitle: "Help desk",
      snippet: clip(h.description),
      href: href("help_desk", h.id),
      updatedAt: h.updatedAt,
      facts: [
        {
          label: "Ticketing",
          value: h.ticketingIntegration ? "Connected" : "Not connected",
        },
      ],
    }));
  },
  conversation: async ({ db, organizationId }, r) => {
    const inbox = await r.settle("conversations", db.getInboxPage(organizationId, { limit: PER_KIND }));
    return newest(inbox?.conversations ?? []).map((c): FindRecord => ({
      key: `conversation:${c.id}`,
      id: c.id,
      kind: "conversation",
      title: c.title || "Untitled conversation",
      subtitle: c.assistantTitle,
      snippet: "",
      href: href("conversation", c.id),
      updatedAt: c.updatedAt,
      facts: [
        { label: "Assistant", value: c.assistantTitle },
        { label: "Messages", value: String(c.messageCount) },
        ...(c.collectionName ? [{ label: "Collection", value: c.collectionName }] : []),
      ],
    }));
  },
  teammate: async (ctx, r) => {
    const teammates = await r.settle("teammates", ctx.listTeammates);
    return newest(teammates ?? []).map((t): FindRecord => ({
      key: `teammate:${t.id}`,
      id: t.id,
      kind: "teammate",
      title: t.name,
      subtitle: t.title || "Teammate",
      snippet: clip(t.roleDescription),
      href: href("teammate", t.id),
      updatedAt: t.updatedAt,
      facts: t.title ? [{ label: "Role", value: t.title }] : [],
    }));
  },
};

/** The list behind the palette: the newest `PER_KIND` of each kind, and whether every kind was read. */
export async function readFindRecords(ctx: FindReadContext): Promise<FindRecordsResult> {
  const r = createReader(ctx);
  const lists = await Promise.all(
    (Object.keys(RECORD_READERS) as FindKind[]).map((kind) => RECORD_READERS[kind](ctx, r))
  );
  return { records: lists.flat(), partial: r.partial };
}

/* ─────────────────────────────── a record's detail ─────────────────────────── */

const noDetail = (over: Partial<FindPreviewData>): FindPreviewData => ({
  summary: null,
  stats: [],
  items: [],
  links: [],
  linksLabel: "Open",
  messages: [],
  ...over,
});

type DetailReader = (ctx: FindReadContext, r: Reader, id: string) => Promise<FindPreviewData | null>;

/**
 * One reader per kind whose preview has more to show than the list carries.
 * `FIND_KIND_INFO[kind].detail` says which kinds those are; a test pins the two
 * to each other.
 */
export const DETAIL_READERS: Partial<Record<FindKind, DetailReader>> = {
  async assistant({ db, organizationId }, r, id) {
    const assistant = await r.must("assistant", db.getAssistant(id));
    if (!assistant || assistant.organizationId !== organizationId) return null;
    const [flows, collections] = await Promise.all([
      r.settle("flows", db.listFlows(id)),
      r.settle("collections", db.listCollections(id)),
    ]);
    return noDetail({
      summary: clip(assistant.description, 200) || null,
      stats: [
        ...(flows
          ? [{ label: "Flows", value: `${flows.filter((f) => f.enabled).length} of ${flows.length} enabled` }]
          : []),
        ...(collections
          ? [{ label: "Knowledge collections", value: String(collections.length) }]
          : []),
      ],
      items: (collections ?? [])
        .slice(0, 4)
        .map((c) => ({ title: c.name, href: FIND_ROUTES.collection(id, c.id) })),
    });
  },

  async help_desk({ db, organizationId }, r, id) {
    const desk = await r.must("help_desk", db.getHelpDesk(id));
    if (!desk || desk.organizationId !== organizationId) return null;
    const channels = await r.settle("channels", db.listSupportChannels(id));
    // A channel is edited on its desk's page, which has no address per channel.
    const deskHref = FIND_KIND_INFO.help_desk.href(id);
    return noDetail({
      summary: clip(desk.description, 200) || null,
      stats: channels
        ? [{ label: "Channels", value: `${channels.filter((c) => c.enabled).length} of ${channels.length} enabled` }]
        : [],
      items: (channels ?? []).slice(0, 5).map((c) => ({ title: c.name, href: deskHref })),
    });
  },

  async conversation({ db, organizationId }, r, id) {
    const conversation = await r.must("conversation", db.getConversation(id));
    if (!conversation) return null;
    // An Assistant conversation is checked against its assistant's Organization.
    // A Teammate one has none of its own: the Db's row-level rule already limits
    // it to the Member it belongs to.
    if (conversation.assistantId) {
      const owner = await r.must("assistant", db.getAssistant(conversation.assistantId));
      if (!owner || owner.organizationId !== organizationId) return null;
    }
    const messages = (await r.settle("messages", db.listMessages(id))) ?? [];
    const firstQuestion = messages.find((m) => m.role === "user");
    const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant");
    const question = firstQuestion ? clip(messageText(firstQuestion.content), 140) : "";
    const answer = lastAnswer ? clip(messageText(lastAnswer.content), 160) : "";
    return noDetail({
      messages: [
        ...(question ? [{ role: "user" as const, text: question }] : []),
        ...(answer ? [{ role: "assistant" as const, text: answer }] : []),
      ],
    });
  },
};

/**
 * The extra a preview shows for the highlighted record. An assistant or a help
 * desk is confirmed to belong to this Organization before anything else about it
 * is read, and a conversation through its assistant, so an id from another
 * tenant answers null like one that never existed. A Teammate conversation has
 * no Organization of its own to check: the Db's row-level rule limits it to the
 * Member it belongs to.
 *
 * The row's own read must succeed (`must`): a failure there throws rather than
 * answering "nothing", so it is never cached as a fact. Secondary reads that
 * fail leave their piece out and mark the answer `partial`.
 */
export async function readFindDetail(
  ctx: FindReadContext,
  kind: FindKind,
  id: string
): Promise<FindPreviewData | null> {
  const reader = DETAIL_READERS[kind];
  if (!reader) return null;
  const r = createReader(ctx);
  const data = await reader(ctx, r, id);
  return data && r.finish(data);
}

/* ─────────────────────────────── a page's live numbers ─────────────────────── */

interface PageScope {
  ctx: FindReadContext;
  r: Reader;
  /** The assistants the read adds up over: the scoped one, or the first few. */
  assistants: Assistant[];
}

const answer = (
  stats: FindPreviewData["stats"],
  links: PageLink[] = [],
  linksLabel = "Open",
  items: PageLink[] = []
): FindPreviewData => noDetail({ stats, links, linksLabel, items });

const fraction = (on: number, total: number, word: string) => `${on} of ${total} ${word}`;

/** A stat when its value was read, nothing when it was not. */
const stat = (label: string, value: string | undefined) =>
  value === undefined ? [] : [{ label, value }];

type Loader = ((scope: PageScope) => Promise<FindPreviewData | null>) & {
  /** The loader adds up over assistants, so the caller resolves them first. */
  overAssistants?: true;
};

/** Marks a loader as one that adds up over assistants. */
const overAssistants = (fn: (scope: PageScope) => Promise<FindPreviewData | null>): Loader =>
  Object.assign(fn, { overAssistants: true as const });

const org = (scope: PageScope) => scope.ctx.organizationId;

/** One read per assistant, all or nothing, keeping which assistant each answer is for. */
async function perAssistant<T>(
  { r, assistants }: PageScope,
  scope: string,
  read: (assistant: Assistant) => PromiseLike<T>
): Promise<Array<{ assistantId: string; value: T }> | undefined> {
  const values = await r.every(scope, assistants.map((a) => () => read(a)));
  return values?.map((value, i) => ({ assistantId: assistants[i]!.id, value }));
}

async function knowledgeStats(scope: PageScope): Promise<FindPreviewData> {
  const { ctx, r } = scope;
  const byAssistant = await perAssistant(scope, "collections", (a) => ctx.db.listCollections(a.id));
  const collections = (byAssistant ?? []).flatMap(({ assistantId, value }) =>
    value.map((c) => ({ ...c, assistantId }))
  );
  const counted = collections.slice(0, SOURCE_COLLECTION_CAP);
  const sources = byAssistant
    ? await r.every("sources", counted.map((c) => () => ctx.db.listSources(c.id)))
    : undefined;
  return answer(
    [
      ...stat("Collections", byAssistant && String(collections.length)),
      // Sources are counted over the first collections only, so past the cap
      // the number is a floor and says so.
      ...stat(
        "Sources",
        sources && `${sources.flat().length}${collections.length > counted.length ? "+" : ""}`
      ),
    ],
    [],
    "Open",
    // A collection is edited in its assistant's knowledge section, which is
    // where both the Library and the SETUP section send it.
    collections.slice(0, 5).map((c) => ({ title: c.name, href: FIND_ROUTES.collection(c.assistantId, c.id) }))
  );
}

const LIVE_LOADERS: Record<LiveTopic, Loader> = {
  async settings(scope) {
    const { ctx, r } = scope;
    const [members, connections, keys] = await Promise.all([
      r.settle("members", ctx.db.listMembers(org(scope))),
      r.settle("connections", ctx.db.listProviderConnections(org(scope))),
      r.settle("api_keys", ctx.listApiKeys),
    ]);
    return answer(
      [
        { label: "Organization", value: ctx.organizationName },
        ...stat("Members", members && String(members.length)),
        ...stat("Provider connections", connections && String(connections.length)),
        ...stat("API keys", keys ? `${keys.filter((k) => !k.revokedAt).length} active` : undefined),
      ],
      [],
      "Open",
      (connections ?? []).slice(0, 4).map((c) => ({ title: c.displayName, href: FIND_ROUTES.aiProviders }))
    );
  },

  library: overAssistants(knowledgeStats),
  knowledge: overAssistants(knowledgeStats),

  async eval(scope) {
    const { ctx, r } = scope;
    const [datasets, runs] = await Promise.all([
      r.settle("eval_datasets", ctx.db.table("evaluationDatasets").list({ organizationId: org(scope) })),
      r.settle("eval_runs", ctx.db.table("evaluationRuns").list({ organizationId: org(scope) })),
    ]);
    // The runs table lists newest first (`ascending: false` in its spec).
    const latest = runs?.[0];
    return answer(
      [
        ...stat("Datasets", datasets && String(datasets.length)),
        ...stat("Runs", runs && String(runs.length)),
        ...stat("Latest run", latest && `${latest.status} · ${latest.createdAt.slice(0, 10)}`),
      ],
      (runs ?? []).slice(0, 5).map((run) => ({
        title: `${run.datasetName} · ${run.status}`,
        href: FIND_ROUTES.evalRun(run.id),
      })),
      "Recent runs"
    );
  },

  async insights({ ctx, r }) {
    const overview = await r.settle("insights", ctx.insights);
    if (!overview) return null;
    const { stats } = overview;
    return answer([
      { label: "Conversations", value: String(stats.total) },
      { label: "Escalated to a human", value: String(stats.escalated) },
      {
        label: "AI resolution",
        value: stats.resolutionRate === null ? "N/A" : formatPercent(stats.resolutionRate),
      },
      { label: "Unique users", value: String(stats.uniqueUsers) },
    ]);
  },

  async alerts(scope) {
    const { ctx, r } = scope;
    const [active, count] = await Promise.all([
      r.settle("alerts", ctx.db.listActiveAlerts(org(scope), 5)),
      r.settle("alert_count", ctx.db.countActiveAlerts(org(scope))),
    ]);
    return answer(
      stat("Need attention", count === undefined ? undefined : String(count)),
      (active ?? []).map((a) => ({ title: a.title, href: FIND_ROUTES.alerts })),
      "Active"
    );
  },

  flows: overAssistants(async (scope) => {
    const { ctx, assistants } = scope;
    const byAssistant = await perAssistant(scope, "flows", (a) => ctx.db.listFlows(a.id));
    const flows = (byAssistant ?? []).flatMap(({ value }) => value);
    return answer(
      [
        ...stat(
          "Flows",
          byAssistant && fraction(flows.filter((f) => f.enabled).length, flows.length, "enabled")
        ),
        ...(assistants.length > 1 ? [{ label: "Assistants", value: String(assistants.length) }] : []),
      ],
      flows
        .filter((f) => !f.builtIn)
        .slice(0, 5)
        .map((f) => ({ title: f.name, href: FIND_ROUTES.flow(f.assistantId, f.id) })),
      "Flows"
    );
  }),

  tools: overAssistants(async (scope) => {
    const { ctx } = scope;
    const [skills, integrations] = await Promise.all([
      perAssistant(scope, "skills", (a) => ctx.db.listAssistantSkills(a.id)),
      perAssistant(scope, "api_integration", (a) => ctx.db.getApiIntegration(a.id)),
    ]);
    const all = (skills ?? []).flatMap(({ assistantId, value }) =>
      value.map((skill) => ({ title: skill.name, href: FIND_ROUTES.section(assistantId, "tools") }))
    );
    return answer(
      [
        ...stat("Skills", skills && String(all.length)),
        ...stat("API integrations", integrations && String(integrations.filter((i) => i.value).length)),
      ],
      all.slice(0, 5),
      "Skills"
    );
  }),

  goals: overAssistants(async (scope) => {
    const { ctx } = scope;
    const byAssistant = await perAssistant(scope, "goals", (a) =>
      ctx.db.table("assistantGoals").list({ assistantId: a.id })
    );
    const goals = (byAssistant ?? []).flatMap(({ value }) => value);
    return answer(
      [
        ...stat(
          "Goals",
          byAssistant && fraction(goals.filter((g) => g.status === "active").length, goals.length, "active")
        ),
        ...stat("Last run failed", byAssistant && String(goals.filter((g) => g.lastResult === "fail").length)),
      ],
      goals.slice(0, 4).map((g) => ({ title: g.question, href: FIND_ROUTES.section(g.assistantId, "goals") })),
      "Goals"
    );
  }),

  guardrails: overAssistants(async ({ assistants }) => {
    const guardrails = assistants.flatMap((a) =>
      (a.guardrails ?? []).map((g) => ({ ...g, assistantId: a.id }))
    );
    return answer(
      [{ label: "Checks", value: fraction(guardrails.filter((g) => g.enabled).length, guardrails.length, "enabled") }],
      guardrails
        .slice(0, 5)
        .map((g) => ({ title: g.name, href: FIND_ROUTES.section(g.assistantId, "guardrails") })),
      "Checks"
    );
  }),

  async assistant_help_desks(scope) {
    const desks = await scope.r.settle("help_desks", scope.ctx.db.listHelpDesks(org(scope)));
    if (!desks) return null;
    return answer(
      [{ label: "Help desks", value: String(desks.length) }],
      desks.slice(0, 5).map((d) => ({ title: d.name, href: FIND_KIND_INFO.help_desk.href(d.id) })),
      "Help desks"
    );
  },

  publish: overAssistants(async (scope) => {
    const { ctx, r, assistants } = scope;
    const publications = await Promise.all(
      assistants.map((a) => r.settle("publication", ctx.db.getLatestPublication(a.id)))
    );
    const allRead = publications.every((p) => p !== undefined);
    const live = publications.filter(Boolean).length;
    return answer(
      stat(
        "Published",
        allRead
          ? `${live} of ${assistants.length} ${assistants.length === 1 ? "assistant" : "assistants"}`
          : undefined
      ),
      assistants.slice(0, 5).map((a, i) => ({
        // A failed read is unknown, not a draft: only a publication that was
        // read and absent earns the label.
        title: `${a.title}${publications[i] === null ? " (draft)" : ""}`,
        href: FIND_ROUTES.section(a.id, "publish"),
      })),
      "Publish from"
    );
  }),
};

/**
 * The live numbers on a console page's preview, for the topics that have a
 * loader. A SETUP section opened from the picker has no assistant in scope, so
 * it adds up over the organization's first few; opened from a scoped link it
 * reads just that one.
 */
export async function readPageStats(
  ctx: FindReadContext,
  href: string
): Promise<FindPreviewData | null> {
  const page = describePage(href);
  if (!page?.live) return null;
  const loader = (LIVE_LOADERS as Partial<Record<PageTopic, Loader>>)[page.topic];
  if (!loader) return null;

  const r = createReader(ctx);
  let assistants: Assistant[] = [];
  if (loader.overAssistants) {
    const listed = (
      await r.settle("assistants", ctx.db.listAssistantsPage(ctx.organizationId, { limit: SCOPE_CAP }))
    )?.items;
    assistants = (page.assistantId ? listed?.filter((a) => a.id === page.assistantId) : listed) ?? [];
    let known = listed !== undefined;
    // A scoped link may name an assistant beyond the first page.
    if (page.assistantId && assistants.length === 0) {
      const one = await r.settle("assistant", ctx.db.getAssistant(page.assistantId));
      known = one !== undefined;
      if (one && one.organizationId === ctx.organizationId) assistants = [one];
    }
    // Every figure below adds up over these assistants, so if they could not
    // be read there is no figure to give: an empty scope would print zeros.
    if (!known) return r.finish(answer([]));
  }
  const stats = await loader({ ctx, r, assistants });
  return stats && r.finish(stats);
}
