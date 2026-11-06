import { assistantAccessRank } from "@agent-hub/core";
import { encodeInboxCursor, inboxPageSize } from "./inbox";
import type { Db } from "./types";
/** Member access overlay for already Organization-scoped privileged runtime reads.
 * It does not replace tenancy pinning. API keys use it inside createOrgPinnedDb;
 * privileged model ports use it with their existing Organization guards. */
export function withMemberAssistantAccess(inner: Db, organizationId: string, actor: { memberId: string }): Db {
    const base = inner;
    const visible = async (assistantId: string) => {
      if ((await base.getAssistant(assistantId))?.organizationId !== organizationId) return false;
      const role = await base.getMemberRole(organizationId, actor.memberId);
      if (!role) return false;
      if (role === "owner") return true;
      const override = (await base.listAssistantAccess(assistantId)).find(row => row.userId === actor.memberId)?.role;
      // A Member limited to selected Assistants reaches only those with a row
      // (20261104132000), the same reading as private.has_assistant_role.
      const scope = override ? undefined : (await base.listMembers(organizationId)).find(item => item.userId === actor.memberId)?.assistantScope;
      return assistantAccessRank({ orgRole: role, override, scope }) > 0;
    };
    const sourceVisible = async (sourceId: string) => {
      const source = await base.getSource(sourceId);
      if (!source || (await base.getCollection(source.collectionId))?.organizationId !== organizationId) return false;
      if (!await base.getMemberRole(organizationId,actor.memberId)) return false;
      const links = await base.listSourceAssistantLinks(sourceId);
      if (!links.length) return true;
      return (await Promise.all(links.map(link => visible(link.assistantId)))).some(Boolean);
    };
    // Filter before client pagination: hidden Sources must not leak through
    // totals, excerpts, or linked-Assistant labels. Read metadata in bounded pages.
    async function visibleLibrary(org: string, filter: Parameters<Db["listOrgKnowledgeSources"]>[1]) {
      const items: Awaited<ReturnType<Db["listOrgKnowledgeSources"]>>["items"] = [];
      let qualityAvailable: boolean | undefined;
      for (let page = 1; ; page++) {
        const batch = await base.listOrgKnowledgeSources(org, { ...filter, page, pageSize: 100 });
        qualityAvailable = batch.qualityAvailable;
        for (const item of batch.items) if (await sourceVisible(item.id)) {
          const allowed = await Promise.all(item.linkedAssistants.map(link => visible(link.assistantId)));
          const usageAllowed = await Promise.all((item.usage?.assistants ?? []).map(row => visible(row.id)));
          items.push({ ...item, linkedAssistants: item.linkedAssistants.filter((_link, index) => allowed[index]),
            ...(item.usage ? { usage: { ...item.usage, assistants: item.usage.assistants.filter((_row, index) => usageAllowed[index]) } } : {}) });
        }
        if (!batch.items.length || page * 100 >= batch.total) break;
      }
      const size = filter.pageSize ?? 50;
      const offset = ((filter.page ?? 1) - 1) * size;
      return { items: items.slice(offset, offset + size), total: items.length, qualityAvailable,
        statusCounts: { processing: items.filter(row => row.status === "processing").length, ready: items.filter(row => row.status === "ready").length, error: items.filter(row => row.status === "error").length } };
    }
    async function visibleInbox(org: string, query: Parameters<Db["getInboxPage"]>[1]) {
      const limit = inboxPageSize(query.limit);
      const conversations: Awaited<ReturnType<Db["getInboxPage"]>>["conversations"] = [];
      let cursor = query.cursor;
      let qualityAvailable: boolean | undefined;
      do {
        const page = await base.getInboxPage(org, { ...query, limit: limit + 1, cursor });
        qualityAvailable = page.qualityAvailable;
        for (const row of page.conversations) if (!row.assistantId || await visible(row.assistantId)) conversations.push(row);
        cursor = page.nextCursor;
      } while (cursor && conversations.length <= limit);
      const last = conversations[limit - 1];
      return { conversations: conversations.slice(0, limit), qualityAvailable, nextCursor: conversations.length > limit && last ? encodeInboxCursor({ updatedAt: last.updatedAt, id: last.id }) : null };
    }
    return new Proxy(base, {
      get(target, property, receiver) {
        if (property === "getInboxPage") return visibleInbox;
        if (property === "getInboxFacets") return async (org: string) => {
          const rows: Awaited<ReturnType<Db["getInboxPage"]>>["conversations"] = [];
          let cursor: string | null | undefined;
          do { const page = await visibleInbox(org, { cursor, limit: 100 }); rows.push(...page.conversations); cursor = page.nextCursor; } while (cursor);
          const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))].sort().slice(0, 200);
          return { locations: unique(rows.map(row => row.metadata.location)), cities: unique(rows.map(row => row.metadata.city)), roles: unique(rows.map(row => row.metadata.userRole)), languages: unique(rows.map(row => row.metadata.language)), workflows: unique(rows.flatMap(row => row.flowNames)) };
        };
        if (property === "listSources") return async (collectionId: string) => {
          const rows = await base.listSources(collectionId);
          const allowed = await Promise.all(rows.map(row => sourceVisible(row.id)));
          return rows.filter((_row, index) => allowed[index]);
        };
        if (property === "listConcepts") return async (collectionId: string) => {
          const rows = await base.listConcepts(collectionId);
          const allowed = await Promise.all(rows.map(row => row.sourceId ? sourceVisible(row.sourceId) : true));
          return rows.filter((_row, index) => allowed[index]);
        };
        if (property === "getAssistant") return async (id: string) => await visible(id) ? base.getAssistant(id) : null;
        if (property === "getSource") return async (id: string) => await sourceVisible(id) ? base.getSource(id) : null;
        if (property === "getConcept") return async (id: string) => {
          const concept = await base.getConcept(id);
          return concept?.sourceId && !await sourceVisible(concept.sourceId) ? null : concept;
        };
        if (property === "listSourceAssistantLinks") return async (id: string) => {
          const links = await base.listSourceAssistantLinks(id);
          const allowed = await Promise.all(links.map(link => visible(link.assistantId)));
          return links.filter((_link,index) => allowed[index]);
        };
        if (property === "getSourceUsage") return async (...args: Parameters<Db["getSourceUsage"]>) => {
          const rows = await base.getSourceUsage(...args);
          const result: typeof rows = [];
          for (const row of rows) if (await sourceVisible(row.sourceId)) {
            const allowed = await Promise.all(row.assistants.map(item => visible(item.id)));
            result.push({ ...row, assistants: row.assistants.filter((_item, index) => allowed[index]) });
          }
          return result;
        };
        if (property === "listOrgKnowledgeSources") return visibleLibrary;
        if (property === "listOrgKnowledgeSourceOptions") return async (org: string, filter: Parameters<Db["listOrgKnowledgeSourceOptions"]>[1]) => {
          const rows = await visibleLibrary(org, { kinds: filter.kinds, pageSize: filter.limit });
          return { items: rows.items.map(({ id, name, kind, collectionId }) => ({ id, name, kind, collectionId })), total: rows.total };
        };
        if (property === "searchChunks") return async (...args: Parameters<Db["searchChunks"]>) => await visible(args[0]) ? base.searchChunks(...args) : [];
        if (property === "listOrgFaqs") return async (org: string) => {
          const rows = await base.listOrgFaqs(org);
          const allowed = await Promise.all(rows.map(row => sourceVisible(row.sourceId)));
          return rows.filter((_row,index) => allowed[index]);
        };
        if (property === "getSourceDocumentByPath") return async (...args: Parameters<Db["getSourceDocumentByPath"]>) => await sourceVisible(args[0]) ? base.getSourceDocumentByPath(...args) : null;
        if (property === "listSourceDocuments") return async (...args: Parameters<Db["listSourceDocuments"]>) => await sourceVisible(args[0]) ? base.listSourceDocuments(...args) : { items: [], total: 0 };
        if (property === "listConceptsBySource") return async (...args: Parameters<Db["listConceptsBySource"]>) => await sourceVisible(args[0]) ? base.listConceptsBySource(...args) : [];
        if (property === "searchCollectionChunks" || property === "searchSourceChunks") return async (...args: Parameters<Db["searchCollectionChunks"]>) => {
          const hits = property === "searchCollectionChunks" ? await base.searchCollectionChunks(...args) : await base.searchSourceChunks(...args);
          const allowed = await Promise.all(hits.map(hit => hit.sourceId ? sourceVisible(hit.sourceId) : true));
          return hits.filter((_hit,index) => allowed[index]);
        };
        if (property === "listAssistants" || property === "listAssistantShellSummaries") return async (org: string) => {
          const rows = property === "listAssistants" ? await base.listAssistants(org) : await base.listAssistantShellSummaries(org);
          const allowed = await Promise.all(rows.map(row => visible(row.id)));
          return rows.filter((_row, index) => allowed[index]);
        };
        if (property === "listAssistantsPage") return async (org: string, input: Parameters<Db["listAssistantsPage"]>[1]) => {
          const items: Awaited<ReturnType<Db["listAssistants"]>> = [];
          let cursor = input.cursor;
          do {
            const page = await base.listAssistantsPage(org, { limit: input.limit + 1, cursor });
            for (const row of page.items) if (await visible(row.id)) items.push(row);
            cursor = page.nextCursor;
          } while (cursor && items.length <= input.limit);
          return { items: items.slice(0, input.limit), nextCursor: items.length > input.limit ? items[input.limit - 1].id : null };
        };
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
}
