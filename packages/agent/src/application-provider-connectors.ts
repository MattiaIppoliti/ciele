import { extractSourceText } from "./extract";
import type {
  ApplicationArtifact,
  ApplicationConnector,
  ApplicationConnectorRegistry,
  ApplicationScopeOption,
} from "./application-connectors";
import {
  ApplicationArtifactSkipError,
  ApplicationAuthorizationError,
  ApplicationRateLimitError,
  applicationContentStrings as contentStrings,
  applicationCredentials as credentials,
  applicationJsonRequest as jsonRequest,
  applicationRetryAfterMs as retryAfterMs,
  applicationValueArray as valueArray,
  defaultApplicationHttpClient as defaultHttpClient,
  normalizedApplicationText as normalizedHtmlText,
  observeHttpClient,
  optionalTrustedUrl,
  refreshApplicationCredentials as refreshCredentials,
  trustedUrl,
  type ApplicationHttpClient,
  type ApplicationHttpResponse,
} from "./application-provider-http";

export {
  ApplicationAuthorizationError,
  ApplicationRateLimitError,
  type ApplicationHttpClient,
  type ApplicationHttpResponse,
};

const FILE_MAX_BYTES = 20 * 1024 * 1024;
/** Provider list pages consumed by one leased durable claim. */
const PROVIDER_PAGE_BUDGET = 5;

interface SlackPendingThread {
  mode: "history" | "revisit";
  channelId: string;
  ts: string;
  rootText: string;
  rootUserId: string;
  thread: string[];
  revisionParts: string[];
  participantIds: string[];
  repliesCursor: string;
  firstRepliesPage: boolean;
  historyCursor?: string;
  historyOldest?: string;
  nextRevisitOffset?: number;
}

export function salesforceConnector(baseClient: ApplicationHttpClient): ApplicationConnector {
  return {
    provider: "salesforce",
    async discoverScopes({ connection, onCredentialsRefreshed }) {
      const client = observeHttpClient(baseClient).client;
      const token = await refreshCredentials(
        "salesforce",
        credentials(connection),
        client
      );
      if (token.refreshed) await onCredentialsRefreshed?.(token.refreshed);
      const baseUrl = (token.active.instanceUrl ?? "").replace(/\/$/, "");
      const host = new URL(baseUrl).hostname;
      const apiVersion = "v65.0";
      const url = new URL(
        `${baseUrl}/services/data/${apiVersion}/support/dataCategoryGroups`
      );
      url.searchParams.set("sObjectName", "KnowledgeArticleVersion");
      url.searchParams.set("topCategoriesOnly", "false");
      const response = await jsonRequest<Record<string, unknown>>(
        client,
        url.toString(),
        token.active.accessToken,
        [host]
      );
      const languageUrl = new URL(
        `${baseUrl}/services/data/${apiVersion}/query`
      );
      languageUrl.searchParams.set(
        "q",
        "SELECT Language, COUNT(Id) FROM KnowledgeArticleVersion WHERE PublishStatus = 'Online' GROUP BY Language"
      );
      const languageResponse = await jsonRequest<Record<string, unknown>>(
        client,
        languageUrl.toString(),
        token.active.accessToken,
        [host]
      );
      const languageCodes = [
        ...new Set(
          valueArray(languageResponse, "records")
            .map((record) => String(record.Language ?? record.language ?? ""))
            .filter(Boolean)
        ),
      ];
      if (languageCodes.length === 0) languageCodes.push("en_US");
      const options: ApplicationScopeOption[] = languageCodes.map(
        (language) => ({
          id: `language:${language}`,
          label: language.replace("_", "-"),
          kind: "language",
          parentId: null,
          metadata: { language },
        })
      );
      const walk = (
        value: Record<string, unknown>,
        groupName: string,
        parentId: string | null
      ) => {
        const name = String(value.name ?? value.id ?? "");
        if (!name) return;
        const id = `category:${groupName}:${name}`;
        options.push({
          id,
          label: String(value.label ?? name),
          kind: "category",
          parentId,
          metadata: { groupName, categoryName: name },
        });
        for (const child of valueArray(value, "childCategories", "children")) {
          walk(child, groupName, id);
        }
      };
      for (const group of valueArray(
        response,
        "dataCategoryGroups",
        "groups"
      )) {
        const groupName = String(group.name ?? group.id ?? "");
        for (const category of valueArray(
          group,
          "topCategories",
          "categories"
        )) {
          walk(category, groupName, null);
        }
      }
      return { scopes: options, refreshedCredentials: token.refreshed };
    },
    async synchronize({ connection, applicationImport, syncStartedAt, knownArtifacts, onCredentialsRefreshed, onProgress }) {
      const observed = observeHttpClient(baseClient, onProgress);
      const client = observed.client;
      const token = await refreshCredentials("salesforce", credentials(connection), client);
      if (token.refreshed) await onCredentialsRefreshed?.(token.refreshed);
      const baseUrl = (token.active.instanceUrl ?? token.active.baseUrl ?? "").replace(/\/$/, "");
      if (!baseUrl) throw new Error("Salesforce instance URL is missing");
      const host = new URL(baseUrl).hostname;
      const apiVersion = String(applicationImport.config.apiVersion ?? "v65.0");
      const language = String(applicationImport.config.language ?? "en_US");
      const scanStartedAt = String(
        applicationImport.checkpoint.scanStartedAt ??
          syncStartedAt ??
          new Date().toISOString()
      );
      const savedNextUrl = String(
        applicationImport.checkpoint.salesforceNextUrl ?? ""
      );
      let nextUrl: string | null = savedNextUrl ||
        `${baseUrl}/services/data/${apiVersion}/support/knowledgeArticles?pageSize=100&sort=LastPublishedDate&order=DESC`;
      const categories = applicationImport.config.dataCategories as
        | string[]
        | undefined;
      if (!savedNextUrl && categories?.length) {
        const initial = new URL(nextUrl);
        initial.searchParams.set(
          "categories",
          JSON.stringify(
            Object.fromEntries(
              categories.slice(0, 3).flatMap((value) => {
                const [group, ...name] = value
                  .replace(/^category:/, "")
                  .split(":");
                return group && name.length
                  ? [[group, name.join(":")]]
                  : [];
              })
            )
          )
        );
        nextUrl = initial.toString();
      }
      const artifacts: ApplicationArtifact[] = [];
      const unchangedRemoteIds: string[] = [];
      const skipped: Array<{ remoteId: string | null; reason: string }> = [];
      let pages = 0;
      while (nextUrl && pages < PROVIDER_PAGE_BUDGET) {
        pages += 1;
        const page: Record<string, unknown> = await jsonRequest(
          client,
          nextUrl,
          token.active.accessToken,
          [host],
          { "accept-language": language }
        );
        for (const summary of valueArray(page, "articles", "items", "records")) {
          const remoteId = String(summary.id ?? summary.articleId ?? "");
          if (!remoteId) continue;
          const summaryRevision =
            String(
              summary.lastPublishedDate ?? summary.versionNumber ?? ""
            ) || null;
          if (knownArtifacts[remoteId]?.revision === summaryRevision) {
            unchangedRemoteIds.push(remoteId);
            continue;
          }
          const detailUrl = summary.url
            ? new URL(String(summary.url), baseUrl).toString()
            : `${baseUrl}/services/data/${apiVersion}/support/knowledgeArticles/${encodeURIComponent(remoteId)}`;
          const detail = await jsonRequest<Record<string, unknown>>(
            client,
            detailUrl,
            token.active.accessToken,
            [host],
            { "accept-language": language }
          );
          const rawText = [...contentStrings(summary), ...contentStrings(detail)].join("\n");
          const text = await normalizedHtmlText(rawText);
          if (!text) {
            skipped.push({ remoteId, reason: "empty_article_content" });
            continue;
          }
          artifacts.push({
            remoteId,
            title: String(detail.title ?? summary.title ?? `Salesforce article ${remoteId}`),
            text,
            canonicalUrl: `${baseUrl}/lightning/r/Knowledge__kav/${encodeURIComponent(remoteId)}/view`,
            revision: String(
              detail.lastPublishedDate ?? detail.versionNumber ?? summary.lastPublishedDate ?? ""
            ) || summaryRevision,
            updatedAt:
              String(detail.lastPublishedDate ?? summary.lastPublishedDate ?? "") || null,
            metadata: { language },
          });
        }
        nextUrl = page.nextPageUrl
          ? new URL(String(page.nextPageUrl), baseUrl).toString()
          : null;
      }
      return {
        artifacts,
        unchangedRemoteIds,
        completeRemoteIds: undefined,
        skipped,
        checkpoint: nextUrl
          ? { salesforceNextUrl: nextUrl, scanStartedAt }
          : { syncedAt: new Date().toISOString() },
        continuationRequired: Boolean(nextUrl),
        completeSnapshotStartedAt: nextUrl ? undefined : scanStartedAt,
        refreshedCredentials: token.refreshed,
        metrics: observed.metrics(),
      };
    },
  };
}

export function serviceNowConnector(baseClient: ApplicationHttpClient): ApplicationConnector {
  return {
    provider: "servicenow",
    async discoverScopes({ connection, onCredentialsRefreshed }) {
      const client = observeHttpClient(baseClient).client;
      const token = await refreshCredentials(
        "servicenow",
        credentials(connection),
        client
      );
      if (token.refreshed) await onCredentialsRefreshed?.(token.refreshed);
      const baseUrl = (token.active.baseUrl ?? "").replace(/\/$/, "");
      const host = new URL(baseUrl).hostname;
      const url = new URL(`${baseUrl}/api/now/table/kb_knowledge_base`);
      url.searchParams.set("sysparm_fields", "sys_id,title");
      url.searchParams.set("sysparm_limit", "500");
      const response = await jsonRequest<Record<string, unknown>>(
        client,
        url.toString(),
        token.active.accessToken,
        [host]
      );
      const scopes = valueArray(response, "result").flatMap(
        (item): ApplicationScopeOption[] => {
          const id = String(item.sys_id ?? "");
          return id
            ? [
                {
                  id,
                  label: String(item.title ?? id),
                  kind: "knowledge_base",
                  parentId: null,
                  metadata: {},
                },
              ]
            : [];
        }
      );
      return { scopes, refreshedCredentials: token.refreshed };
    },
    async synchronize({ connection, applicationImport, syncStartedAt, knownArtifacts, onCredentialsRefreshed, onProgress }) {
      const observed = observeHttpClient(baseClient, onProgress);
      const client = observed.client;
      const token = await refreshCredentials("servicenow", credentials(connection), client);
      if (token.refreshed) await onCredentialsRefreshed?.(token.refreshed);
      const baseUrl = (token.active.baseUrl ?? "").replace(/\/$/, "");
      if (!baseUrl) throw new Error("ServiceNow base URL is missing");
      const host = new URL(baseUrl).hostname;
      const limit = 100;
      const scanStartedAt = String(
        applicationImport.checkpoint.scanStartedAt ??
          syncStartedAt ??
          new Date().toISOString()
      );
      let offset = Number(applicationImport.checkpoint.serviceNowOffset ?? 0);
      const artifacts: ApplicationArtifact[] = [];
      const unchangedRemoteIds: string[] = [];
      const skipped: Array<{ remoteId: string | null; reason: string }> = [];
      let pages = 0;
      let continuationRequired = false;
      while (pages < PROVIDER_PAGE_BUDGET) {
        pages += 1;
        const url = new URL(`${baseUrl}/api/sn_km_api/knowledge/articles`);
        url.searchParams.set("limit", String(limit));
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("language", String(applicationImport.config.language ?? "all"));
        url.searchParams.set(
          "fields",
          "sys_id,number,short_description,text,sys_updated_on,permalink"
        );
        if (applicationImport.config.knowledgeBaseIds) {
          url.searchParams.set(
            "kb",
            (applicationImport.config.knowledgeBaseIds as string[]).join(",")
          );
        }
        const page = await jsonRequest<Record<string, unknown>>(
          client,
          url.toString(),
          token.active.accessToken,
          [host]
        );
        const items = valueArray(page, "result", "articles", "items");
        for (const item of items) {
          const remoteId = String(item.sys_id ?? item.id ?? "");
          if (!remoteId) continue;
          const revision =
            String(item.sys_updated_on ?? item.updated_on ?? "") || null;
          if (knownArtifacts[remoteId]?.revision === revision) {
            unchangedRemoteIds.push(remoteId);
            continue;
          }
          let rawText = String(item.text ?? item.content ?? "");
          if (!rawText) {
            const detail = await jsonRequest<Record<string, unknown>>(
              client,
              `${baseUrl}/api/sn_km_api/knowledge/articles/${encodeURIComponent(remoteId)}`,
              token.active.accessToken,
              [host]
            );
            rawText = contentStrings(detail).join("\n");
          }
          const text = await normalizedHtmlText(rawText);
          if (!text) {
            skipped.push({ remoteId, reason: "empty_article_content" });
            continue;
          }
          const number = String(item.number ?? remoteId);
          const providerUrl = optionalTrustedUrl(
            String(item.permalink ?? ""),
            [host]
          );
          artifacts.push({
            remoteId,
            title: String(item.short_description ?? item.title ?? number),
            text,
            canonicalUrl:
              providerUrl ??
              `${baseUrl}/kb_view.do?sysparm_article=${encodeURIComponent(number)}`,
            revision,
            updatedAt: String(item.sys_updated_on ?? item.updated_on ?? "") || null,
            metadata: { number },
          });
        }
        if (items.length < limit) break;
        offset += limit;
        if (pages >= PROVIDER_PAGE_BUDGET) continuationRequired = true;
      }
      return {
        artifacts,
        unchangedRemoteIds,
        completeRemoteIds: undefined,
        skipped,
        checkpoint: continuationRequired
          ? { serviceNowOffset: offset, scanStartedAt }
          : { syncedAt: new Date().toISOString() },
        continuationRequired,
        completeSnapshotStartedAt: continuationRequired ? undefined : scanStartedAt,
        refreshedCredentials: token.refreshed,
        metrics: observed.metrics(),
      };
    },
  };
}

export function slackConnector(baseClient: ApplicationHttpClient): ApplicationConnector {
  return {
    provider: "slack",
    async discoverScopes({ connection, onCredentialsRefreshed }) {
      const client = observeHttpClient(baseClient).client;
      const token = await refreshCredentials(
        "slack",
        credentials(connection),
        client
      );
      if (token.refreshed) await onCredentialsRefreshed?.(token.refreshed);
      const options: ApplicationScopeOption[] = [];
      let cursor = "";
      do {
        const url = new URL("https://slack.com/api/conversations.list");
        url.searchParams.set("types", "public_channel,private_channel");
        url.searchParams.set("exclude_archived", "true");
        url.searchParams.set("limit", "200");
        if (cursor) url.searchParams.set("cursor", cursor);
        const page = await jsonRequest<Record<string, unknown>>(
          client,
          url.toString(),
          token.active.accessToken,
          ["slack.com"]
        );
        for (const channel of valueArray(page, "channels")) {
          const id = String(channel.id ?? "");
          if (!id || channel.is_member !== true) continue;
          options.push({
            id,
            label: `#${String(channel.name ?? id)}`,
            kind: "channel",
            parentId: null,
            metadata: { private: Boolean(channel.is_private) },
          });
        }
        cursor = String(
          (page.response_metadata as Record<string, unknown> | undefined)
            ?.next_cursor ?? ""
        );
      } while (cursor);
      return { scopes: options, refreshedCredentials: token.refreshed };
    },
    async synchronize({ connection, applicationImport, knownArtifacts, onCredentialsRefreshed, onProgress }) {
      const observed = observeHttpClient(baseClient, onProgress);
      const client = observed.client;
      const token = await refreshCredentials("slack", credentials(connection), client);
      if (token.refreshed) await onCredentialsRefreshed?.(token.refreshed);
      const channelIds = applicationImport.config.channelIds as string[] | undefined;
      if (!channelIds?.length) throw new Error("Select at least one Slack channel");
      const rawChannelOffset = Number(
        applicationImport.checkpoint.slackChannelOffset ?? 0
      );
      const channelStart =
        ((Number.isFinite(rawChannelOffset) ? rawChannelOffset : 0) %
          channelIds.length +
          channelIds.length) %
        channelIds.length;
      const orderedChannelIds = [
        ...channelIds.slice(channelStart),
        ...channelIds.slice(0, channelStart),
      ];
      let nextSlackChannelOffset = channelStart;
      const previous =
        (applicationImport.checkpoint.latestByChannel as Record<string, string> | undefined) ?? {};
      const previousHistoryCursors =
        (applicationImport.checkpoint.historyCursorByChannel as Record<string, string> | undefined) ?? {};
      const previousHistoryOldest =
        (applicationImport.checkpoint.historyOldestByChannel as Record<string, string> | undefined) ?? {};
      const historyDays = Math.max(
        1,
        Number(applicationImport.config.historyDays ?? 180)
      );
      const initialOldest = applicationImport.config.allHistory
        ? ""
        : String((Date.now() - historyDays * 24 * 60 * 60 * 1000) / 1000);
      const latestByChannel: Record<string, string> = { ...previous };
      const historyCursorByChannel: Record<string, string> = {
        ...previousHistoryCursors,
      };
      const historyOldestByChannel: Record<string, string> = {
        ...previousHistoryOldest,
      };
      let continuationRequired = false;
      const previousRevisitOffsets =
        (applicationImport.checkpoint.revisitOffsetByChannel as Record<string, number> | undefined) ?? {};
      const revisitOffsetByChannel: Record<string, number> = { ...previousRevisitOffsets };
      const artifacts: ApplicationArtifact[] = [];
      const deletedRemoteIds: string[] = [];
      const fetchedRemoteIds = new Set<string>();
      const skipped: Array<{ remoteId: string | null; reason: string }> = [];
      const memberNames = new Map<string, string>();
      let membersCursor = "";
      let memberPages = 0;
      do {
        memberPages += 1;
        const membersUrl = new URL("https://slack.com/api/users.list");
        membersUrl.searchParams.set("limit", "200");
        if (membersCursor) membersUrl.searchParams.set("cursor", membersCursor);
        const membersPage = await jsonRequest<Record<string, unknown>>(
          client,
          membersUrl.toString(),
          token.active.accessToken,
          ["slack.com"]
        );
        if (membersPage.ok === false) {
          throw new Error("Slack member directory could not be read");
        }
        for (const member of valueArray(membersPage, "members")) {
          const id = String(member.id ?? "");
          const profile =
            (member.profile as Record<string, unknown> | undefined) ?? {};
          const label = String(
            profile.display_name ?? profile.real_name ?? member.name ?? id
          ).trim();
          if (id && label) memberNames.set(id, label);
        }
        membersCursor = String(
          (
            membersPage.response_metadata as
              | Record<string, unknown>
              | undefined
          )?.next_cursor ?? ""
        );
      } while (membersCursor && memberPages < PROVIDER_PAGE_BUDGET);
      let remainingPageBudget = PROVIDER_PAGE_BUDGET;
      const attributedMessage = (message: Record<string, unknown>): string => {
        const userId = String(message.user ?? message.bot_id ?? "");
        const author = (memberNames.get(userId) ?? userId) || "Unknown member";
        const ts = String(message.ts ?? "");
        const at = Number.isFinite(Number(ts))
          ? new Date(Number(ts) * 1000).toISOString()
          : ts;
        return `[${author}${at ? ` · ${at}` : ""}] ${String(message.text ?? "").trim()}`;
      };
      const finishThread = (pending: SlackPendingThread) => {
        const participants = [...new Set(pending.participantIds)];
        artifacts.push({
          remoteId: `${pending.channelId}:${pending.ts}`,
          title:
            pending.rootText.length > 100
              ? `${pending.rootText.slice(0, 97)}...`
              : pending.rootText,
          text: pending.thread.join("\n\n"),
          canonicalUrl: token.active.teamId
            ? `https://app.slack.com/client/${token.active.teamId}/${pending.channelId}/thread/${pending.ts.replace(".", "")}`
            : null,
          revision: pending.revisionParts.join(":"),
          updatedAt: new Date(Number(pending.ts) * 1000).toISOString(),
          metadata: {
            channelId: pending.channelId,
            authorId: pending.rootUserId || null,
            authorName: memberNames.get(pending.rootUserId) ?? null,
            participants: participants.map((id) => ({
              id,
              name: memberNames.get(id) ?? null,
            })),
            timestamp: pending.ts,
            replyCount: Math.max(0, pending.thread.length - 1),
          },
        });
        fetchedRemoteIds.add(`${pending.channelId}:${pending.ts}`);
      };
      const continueThread = async (
        pending: SlackPendingThread
      ): Promise<SlackPendingThread | null> => {
        while (remainingPageBudget > 0) {
          remainingPageBudget -= 1;
          const repliesUrl = new URL(
            "https://slack.com/api/conversations.replies"
          );
          repliesUrl.searchParams.set("channel", pending.channelId);
          repliesUrl.searchParams.set("ts", pending.ts);
          repliesUrl.searchParams.set("limit", "100");
          if (pending.repliesCursor) {
            repliesUrl.searchParams.set("cursor", pending.repliesCursor);
          }
          const replies = await jsonRequest<Record<string, unknown>>(
            client,
            repliesUrl.toString(),
            token.active.accessToken,
            ["slack.com"]
          );
          if (replies.ok === false) {
            if (
              ["message_not_found", "thread_not_found"].includes(
                String(replies.error)
              )
            ) {
              deletedRemoteIds.push(`${pending.channelId}:${pending.ts}`);
              return null;
            }
            throw new Error(`Slack error: ${String(replies.error ?? "unknown")}`);
          }
          const messages = valueArray(replies, "messages");
          if (pending.firstRepliesPage) {
            const root = messages[0];
            if (!root) {
              deletedRemoteIds.push(`${pending.channelId}:${pending.ts}`);
              return null;
            }
            if (!pending.rootText) {
              const rootText = String(root.text ?? "").trim();
              if (!rootText || root.subtype) {
                skipped.push({
                  remoteId: `${pending.channelId}:${pending.ts}`,
                  reason: !rootText
                    ? "empty_message"
                    : "unsupported_message_subtype",
                });
                return null;
              }
              pending.rootText = rootText;
              pending.rootUserId = String(root.user ?? root.bot_id ?? "");
              pending.thread = [attributedMessage(root)];
              pending.revisionParts = [
                String(
                  (root.edited as Record<string, unknown> | undefined)?.ts ??
                    root.ts ??
                    pending.ts
                ),
              ];
              pending.participantIds = pending.rootUserId
                ? [pending.rootUserId]
                : [];
            }
          }
          for (const reply of messages.slice(pending.firstRepliesPage ? 1 : 0)) {
            const replyText = String(reply.text ?? "").trim();
            if (!replyText) continue;
            const replyUserId = String(reply.user ?? reply.bot_id ?? "");
            if (replyUserId) pending.participantIds.push(replyUserId);
            pending.thread.push(attributedMessage(reply));
            pending.revisionParts.push(
              String(
                (reply.edited as Record<string, unknown> | undefined)?.ts ??
                  reply.ts ??
                  ""
              )
            );
          }
          pending.firstRepliesPage = false;
          pending.repliesCursor = String(
            (
              replies.response_metadata as
                | Record<string, unknown>
                | undefined
            )?.next_cursor ?? ""
          );
          if (!pending.repliesCursor) {
            finishThread(pending);
            return null;
          }
        }
        return pending;
      };
      const continuationResult = (pending?: SlackPendingThread) => ({
        artifacts,
        deletedRemoteIds,
        skipped,
        checkpoint: {
          latestByChannel,
          revisitOffsetByChannel,
          historyCursorByChannel,
          historyOldestByChannel,
          slackChannelOffset: nextSlackChannelOffset,
          ...(pending ? { slackPendingThread: pending } : {}),
        },
        continuationRequired: true,
        refreshedCredentials: token.refreshed,
        metrics: observed.metrics(),
      });

      const completedHistoryChannels = new Set<string>();
      const savedPending = applicationImport.checkpoint
        .slackPendingThread as SlackPendingThread | undefined;
      if (savedPending) {
        const pending = await continueThread({ ...savedPending });
        if (pending) return continuationResult(pending);
        if (savedPending.mode === "history" && !savedPending.historyCursor) {
          delete previousHistoryCursors[savedPending.channelId];
          delete previousHistoryOldest[savedPending.channelId];
          delete historyCursorByChannel[savedPending.channelId];
          delete historyOldestByChannel[savedPending.channelId];
          completedHistoryChannels.add(savedPending.channelId);
        }
        if (
          savedPending.mode === "revisit" &&
          savedPending.nextRevisitOffset !== undefined
        ) {
          revisitOffsetByChannel[savedPending.channelId] =
            savedPending.nextRevisitOffset;
        }
      }

      channelLoop: for (
        let orderedIndex = 0;
        orderedIndex < orderedChannelIds.length;
        orderedIndex += 1
      ) {
        const channelId = orderedChannelIds[orderedIndex]!;
        const channelIndex = (channelStart + orderedIndex) % channelIds.length;
        nextSlackChannelOffset = channelIndex;
        if (remainingPageBudget === 0) {
          continuationRequired = true;
          break channelLoop;
        }
        let cursor = previousHistoryCursors[channelId] ?? "";
        const historyOldest = previousHistoryOldest[channelId] ??
          previous[channelId] ?? initialOldest;
        if (!completedHistoryChannels.has(channelId) && remainingPageBudget <= 2) {
          historyCursorByChannel[channelId] = cursor;
          historyOldestByChannel[channelId] = historyOldest;
          continuationRequired = true;
          break channelLoop;
        }
        let historyPagesThisChannel = 0;
        while (
          !completedHistoryChannels.has(channelId) &&
          remainingPageBudget > 2 &&
          historyPagesThisChannel < 1
        ) {
          remainingPageBudget -= 1;
          historyPagesThisChannel += 1;
          const url = new URL("https://slack.com/api/conversations.history");
          url.searchParams.set("channel", channelId);
          // One root per page lets a thread continuation persist the exact
          // next history cursor without retaining unprocessed page payloads.
          url.searchParams.set("limit", "1");
          if (cursor) url.searchParams.set("cursor", cursor);
          if (historyOldest) {
            url.searchParams.set("oldest", historyOldest);
          }
          const page = await jsonRequest<Record<string, unknown>>(
            client,
            url.toString(),
            token.active.accessToken,
            ["slack.com"]
          );
          if (page.ok === false) throw new Error(`Slack error: ${String(page.error ?? "unknown")}`);
          const nextHistoryCursor = String(
            (page.response_metadata as Record<string, unknown> | undefined)
              ?.next_cursor ?? ""
          );
          for (const message of valueArray(page, "messages")) {
            const ts = String(message.ts ?? "");
            const rootText = String(message.text ?? "").trim();
            if (!ts) {
              skipped.push({ remoteId: null, reason: "missing_message_timestamp" });
              continue;
            }
            if (!rootText) {
              skipped.push({ remoteId: `${channelId}:${ts}`, reason: "empty_message" });
              continue;
            }
            if (message.subtype) {
              skipped.push({
                remoteId: `${channelId}:${ts}`,
                reason: "unsupported_message_subtype",
              });
              continue;
            }
            const rootUserId = String(message.user ?? message.bot_id ?? "");
            if (!latestByChannel[channelId] || ts > latestByChannel[channelId]) {
              latestByChannel[channelId] = ts;
            }
            if (Number(message.reply_count ?? 0) > 0) {
              const pending = await continueThread({
                mode: "history",
                channelId,
                ts,
                rootText,
                rootUserId,
                thread: [attributedMessage(message)],
                revisionParts: [
                  String(
                    (message.edited as Record<string, unknown> | undefined)
                      ?.ts ?? ts
                  ),
                ],
                participantIds: rootUserId ? [rootUserId] : [],
                repliesCursor: "",
                firstRepliesPage: true,
                historyCursor: nextHistoryCursor,
                historyOldest,
              });
              if (pending) {
                historyCursorByChannel[channelId] = nextHistoryCursor;
                historyOldestByChannel[channelId] = historyOldest;
                return continuationResult(pending);
              }
            } else {
              finishThread({
                mode: "history",
                channelId,
                ts,
                rootText,
                rootUserId,
                thread: [attributedMessage(message)],
                revisionParts: [
                  String(
                    (message.edited as Record<string, unknown> | undefined)
                      ?.ts ?? ts
                  ),
                ],
                participantIds: rootUserId ? [rootUserId] : [],
                repliesCursor: "",
                firstRepliesPage: false,
              });
            }
          }
          cursor = nextHistoryCursor;
          if (!cursor) break;
        }
        if (cursor) {
          historyCursorByChannel[channelId] = cursor;
          historyOldestByChannel[channelId] = historyOldest;
          continuationRequired = true;
        } else {
          delete historyCursorByChannel[channelId];
          delete historyOldestByChannel[channelId];
        }

        // Slack has no complete delta feed for thread replies/edits/deletes.
        // Revisit a rotating, bounded slice of already materialized roots so
        // old threads eventually converge without turning one claim unbounded.
        const knownRoots = Object.keys(knownArtifacts)
          .filter((remoteId) => remoteId.startsWith(`${channelId}:`))
          .filter((remoteId) => !fetchedRemoteIds.has(remoteId))
          .sort();
        const revisitLimit = PROVIDER_PAGE_BUDGET;
        const start = knownRoots.length
          ? (previousRevisitOffsets[channelId] ?? 0) % knownRoots.length
          : 0;
        const revisits = Array.from(
          { length: Math.min(revisitLimit, knownRoots.length) },
          (_, index) => knownRoots[(start + index) % knownRoots.length]!
        );
        for (let revisitIndex = 0; revisitIndex < revisits.length; revisitIndex += 1) {
          const remoteId = revisits[revisitIndex]!;
          if (remainingPageBudget === 0) {
            break;
          }
          const ts = remoteId.slice(channelId.length + 1);
          const nextRevisitOffset = knownRoots.length
            ? (start + revisitIndex + 1) % knownRoots.length
            : 0;
          const pending = await continueThread({
            mode: "revisit",
            channelId,
            ts,
            rootText: "",
            rootUserId: "",
            thread: [],
            revisionParts: [],
            participantIds: [],
            repliesCursor: "",
            firstRepliesPage: true,
            nextRevisitOffset,
          });
          if (pending) return continuationResult(pending);
          revisitOffsetByChannel[channelId] = nextRevisitOffset;
        }
        nextSlackChannelOffset = (channelIndex + 1) % channelIds.length;
      }
      return {
        artifacts,
        deletedRemoteIds,
        skipped,
        checkpoint: {
          latestByChannel,
          revisitOffsetByChannel,
          slackChannelOffset: nextSlackChannelOffset,
          ...(continuationRequired
            ? { historyCursorByChannel, historyOldestByChannel }
            : {}),
        },
        continuationRequired,
        refreshedCredentials: token.refreshed,
        metrics: observed.metrics(),
      };
    },
  };
}

function supportedDriveFile(name: string): boolean {
  return /\.(pdf|docx|txt|md|csv|html?)$/i.test(name);
}

async function extractDownloadedFile(
  client: ApplicationHttpClient,
  url: string,
  name: string,
  allowedHosts: string[],
  accessToken?: string
): Promise<string> {
  const response = await client(trustedUrl(url, allowedHosts), {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    maxResponseBytes: FILE_MAX_BYTES,
    // Keep bearer credentials and provider-signed download URLs on the host
    // that passed the Connector allowlist. The shared egress guard validates
    // public redirect targets for SSRF, but it cannot know provider ownership.
    maxRedirects: 0,
  });
  if (response.status === 429) {
    throw new ApplicationRateLimitError(retryAfterMs(response.headers));
  }
  if (response.status === 401 || response.status === 403) {
    if (accessToken) throw new ApplicationAuthorizationError();
    throw new Error(`Signed file download returned HTTP ${response.status}`);
  }
  if (response.status === 408 || response.status === 425 || response.status >= 500) {
    throw new Error(`Transient file download returned HTTP ${response.status}`);
  }
  if (!response.ok) {
    throw new ApplicationArtifactSkipError(
      `File download returned HTTP ${response.status}`
    );
  }
  const bytes = response.bytes ?? new TextEncoder().encode(response.text);
  const copy = Uint8Array.from(bytes);
  try {
    return (
      await extractSourceText({
        kind: "file",
        name,
        bytes: copy.buffer,
      })
    ).text;
  } catch (error) {
    throw new ApplicationArtifactSkipError(
      error instanceof Error ? error.message : "File extraction failed"
    );
  }
}

export function oneDriveConnector(baseClient: ApplicationHttpClient): ApplicationConnector {
  return {
    provider: "onedrive",
    async discoverScopes({ connection, onCredentialsRefreshed }) {
      const client = observeHttpClient(baseClient).client;
      const token = await refreshCredentials(
        "onedrive",
        credentials(connection),
        client
      );
      if (token.refreshed) await onCredentialsRefreshed?.(token.refreshed);
      const drive = await jsonRequest<Record<string, unknown>>(
        client,
        "https://graph.microsoft.com/v1.0/me/drive?$select=id,name,driveType",
        token.active.accessToken,
        ["graph.microsoft.com"]
      );
      const driveId = String(drive.id ?? "me");
      const options: ApplicationScopeOption[] = [
        {
          id: `drive:${driveId}`,
          label: String(drive.name ?? "My OneDrive"),
          kind: "drive",
          parentId: null,
          metadata: { driveId },
        },
      ];
      const pending: Array<{ id: string; parentId: string }> = [
        { id: "root", parentId: `drive:${driveId}` },
      ];
      while (pending.length > 0 && options.length <= 500) {
        const current = pending.shift()!;
        let nextUrl = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/${current.id === "root" ? "root" : `items/${encodeURIComponent(current.id)}`}/children?$select=id,name,folder`;
        while (nextUrl) {
          const page = await jsonRequest<Record<string, unknown>>(
            client,
            nextUrl,
            token.active.accessToken,
            ["graph.microsoft.com"]
          );
          for (const item of valueArray(page, "value")) {
            if (!item.folder) continue;
            const id = String(item.id ?? "");
            if (!id) continue;
            options.push({
              id: `folder:${driveId}:${id}`,
              label: String(item.name ?? id),
              kind: "folder",
              parentId: current.parentId,
              metadata: { driveId, folderId: id },
            });
            pending.push({ id, parentId: `folder:${driveId}:${id}` });
          }
          nextUrl = String(page["@odata.nextLink"] ?? "");
        }
      }
      return { scopes: options, refreshedCredentials: token.refreshed };
    },
    async synchronize({ connection, applicationImport, onCredentialsRefreshed, onProgress }) {
      const observed = observeHttpClient(baseClient, onProgress);
      const client = observed.client;
      const token = await refreshCredentials("onedrive", credentials(connection), client);
      if (token.refreshed) await onCredentialsRefreshed?.(token.refreshed);
      const driveId = String(applicationImport.config.driveId ?? "me");
      const folderId = String(applicationImport.config.folderId ?? "");
      const driveRoot =
        driveId && driveId !== "me"
          ? `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}`
          : "https://graph.microsoft.com/v1.0/me/drive";
      let nextUrl = String(
        applicationImport.checkpoint.deltaLink ??
          (folderId
            ? `${driveRoot}/items/${encodeURIComponent(folderId)}/delta`
            : `${driveRoot}/root/delta`)
      );
      const artifacts: ApplicationArtifact[] = [];
      const deletedRemoteIds: string[] = [];
      const skipped: Array<{ remoteId: string | null; reason: string }> = [];
      let deltaLink = nextUrl;
      let pages = 0;
      while (nextUrl && pages < PROVIDER_PAGE_BUDGET) {
        pages += 1;
        const page = await jsonRequest<Record<string, unknown>>(
          client,
          nextUrl,
          token.active.accessToken,
          ["graph.microsoft.com"]
        );
        for (const item of valueArray(page, "value")) {
          const remoteId = String(item.id ?? "");
          if (!remoteId) {
            skipped.push({ remoteId: null, reason: "missing_remote_id" });
            continue;
          }
          if (item.deleted) {
            deletedRemoteIds.push(remoteId);
            continue;
          }
          const name = String(item.name ?? "");
          if (!item.file) continue;
          if (!supportedDriveFile(name)) {
            skipped.push({ remoteId, reason: "unsupported_file_type" });
            continue;
          }
          const downloadUrl = String(item["@microsoft.graph.downloadUrl"] ?? "");
          if (!downloadUrl) {
            skipped.push({ remoteId, reason: "download_unavailable" });
            continue;
          }
          let text: string;
          try {
            text = await extractDownloadedFile(
              client,
              downloadUrl,
              name,
              ["1drv.com", "sharepoint.com", "onedrive.com"]
            );
          } catch (error) {
            if (!(error instanceof ApplicationArtifactSkipError)) throw error;
            skipped.push({ remoteId, reason: "download_or_extraction_failed" });
            continue;
          }
          const mimeType = String(
            (item.file as Record<string, unknown>).mimeType ?? ""
          );
          artifacts.push({
            remoteId,
            title: name,
            text,
            canonicalUrl: optionalTrustedUrl(String(item.webUrl ?? ""), [
              "1drv.com",
              "onedrive.com",
              "onedrive.live.com",
              "sharepoint.com",
            ]),
            revision: String(item.eTag ?? item.cTag ?? item.lastModifiedDateTime ?? "") || null,
            updatedAt: String(item.lastModifiedDateTime ?? "") || null,
            mimeType: mimeType || null,
            metadata: { mimeType },
          });
        }
        nextUrl = String(page["@odata.nextLink"] ?? "");
        deltaLink = String(page["@odata.deltaLink"] ?? deltaLink);
      }
      return {
        artifacts,
        deletedRemoteIds,
        skipped,
        checkpoint: { deltaLink: nextUrl || deltaLink },
        continuationRequired: Boolean(nextUrl),
        refreshedCredentials: token.refreshed,
        metrics: observed.metrics(),
      };
    },
  };
}

async function googleFileArtifact(
  client: ApplicationHttpClient,
  accessToken: string,
  file: Record<string, unknown>
): Promise<{
  artifact: ApplicationArtifact | null;
  skipped?: { remoteId: string | null; reason: string };
}> {
  const id = String(file.id ?? "");
  const name = String(file.name ?? "");
  const mimeType = String(file.mimeType ?? "");
  if (!id || !name) {
    return {
      artifact: null,
      skipped: { remoteId: id || null, reason: "missing_file_identity" },
    };
  }
  if (mimeType === "application/vnd.google-apps.folder") {
    return { artifact: null };
  }
  let url: string;
  let extractName = name;
  if (mimeType.startsWith("application/vnd.google-apps.")) {
    const exportMime = mimeType.endsWith("spreadsheet") ? "text/csv" : "text/plain";
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exportMime)}`;
    extractName += exportMime === "text/csv" ? ".csv" : ".txt";
  } else {
    if (!supportedDriveFile(name)) {
      return {
        artifact: null,
        skipped: { remoteId: id, reason: "unsupported_file_type" },
      };
    }
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`;
  }
  try {
    const text = await extractDownloadedFile(
      client,
      url,
      extractName,
      ["googleapis.com"],
      accessToken
    );
    return {
      artifact: {
        remoteId: id,
        title: name,
        text,
        canonicalUrl: optionalTrustedUrl(String(file.webViewLink ?? ""), [
          "drive.google.com",
          "docs.google.com",
        ]),
        revision:
          String(
            file.headRevisionId ?? file.md5Checksum ?? file.modifiedTime ?? ""
          ) || null,
        updatedAt: String(file.modifiedTime ?? "") || null,
        mimeType,
        metadata: { mimeType },
      },
    };
  } catch (error) {
    if (!(error instanceof ApplicationArtifactSkipError)) throw error;
    return {
      artifact: null,
      skipped: { remoteId: id, reason: "download_or_extraction_failed" },
    };
  }
}

const GOOGLE_FILE_FIELDS =
  "id,name,mimeType,modifiedTime,md5Checksum,headRevisionId,webViewLink,trashed,parents";

export function googleDriveConnector(baseClient: ApplicationHttpClient): ApplicationConnector {
  return {
    provider: "google_drive",
    async discoverScopes({ connection, onCredentialsRefreshed }) {
      const client = observeHttpClient(baseClient).client;
      const token = await refreshCredentials(
        "google_drive",
        credentials(connection),
        client
      );
      if (token.refreshed) await onCredentialsRefreshed?.(token.refreshed);
      const drivesPage = await jsonRequest<Record<string, unknown>>(
        client,
        "https://www.googleapis.com/drive/v3/drives?pageSize=100&fields=drives(id,name)",
        token.active.accessToken,
        ["googleapis.com"]
      );
      const drives = [
        { id: "", name: "My Drive", rootFolderId: "root" },
        ...valueArray(drivesPage, "drives").map((drive) => ({
          id: String(drive.id ?? ""),
          name: String(drive.name ?? drive.id ?? "Shared Drive"),
          rootFolderId: "",
        })),
      ];
      const options: ApplicationScopeOption[] = [];
      for (const drive of drives) {
        const driveOptionId = `drive:${drive.id || "my_drive"}`;
        options.push({
          id: driveOptionId,
          label: drive.name,
          kind: "drive",
          parentId: null,
          metadata: {
            driveId: drive.id,
            ...(drive.rootFolderId
              ? { folderId: drive.rootFolderId }
              : {}),
          },
        });
        const folders: Array<Record<string, unknown>> = [];
        let pageToken = "";
        do {
          const url = new URL("https://www.googleapis.com/drive/v3/files");
          url.searchParams.set("pageSize", "1000");
          url.searchParams.set(
            "q",
            "mimeType = 'application/vnd.google-apps.folder' and trashed = false"
          );
          url.searchParams.set("fields", "nextPageToken,files(id,name,parents)");
          url.searchParams.set("supportsAllDrives", "true");
          url.searchParams.set("includeItemsFromAllDrives", "true");
          if (drive.id) {
            url.searchParams.set("corpora", "drive");
            url.searchParams.set("driveId", drive.id);
          }
          if (pageToken) url.searchParams.set("pageToken", pageToken);
          const page = await jsonRequest<Record<string, unknown>>(
            client,
            url.toString(),
            token.active.accessToken,
            ["googleapis.com"]
          );
          folders.push(...valueArray(page, "files"));
          pageToken = String(page.nextPageToken ?? "");
        } while (pageToken && folders.length < 1000);
        const ids = new Set(folders.map((folder) => String(folder.id ?? "")));
        for (const folder of folders) {
          const id = String(folder.id ?? "");
          if (!id) continue;
          const parent = Array.isArray(folder.parents)
            ? String((folder.parents as unknown[])[0] ?? "")
            : "";
          options.push({
            id: `folder:${drive.id || "my_drive"}:${id}`,
            label: String(folder.name ?? id),
            kind: "folder",
            parentId: ids.has(parent)
              ? `folder:${drive.id || "my_drive"}:${parent}`
              : driveOptionId,
            metadata: { driveId: drive.id, folderId: id },
          });
        }
      }
      return { scopes: options, refreshedCredentials: token.refreshed };
    },
    async synchronize({ connection, applicationImport, onCredentialsRefreshed, onProgress }) {
      const observed = observeHttpClient(baseClient, onProgress);
      const client = observed.client;
      const token = await refreshCredentials("google_drive", credentials(connection), client);
      if (token.refreshed) await onCredentialsRefreshed?.(token.refreshed);
      const pageToken = String(applicationImport.checkpoint.pageToken ?? "");
      const folderId = String(applicationImport.config.folderId ?? "");
      const driveId = String(applicationImport.config.driveId ?? "");
      const folderIds = new Set<string>(
        (applicationImport.checkpoint.folderIds as string[] | undefined) ??
          (folderId ? [folderId] : [])
      );
      const artifacts: ApplicationArtifact[] = [];
      const deletedRemoteIds: string[] = [];
      const skipped: Array<{ remoteId: string | null; reason: string }> = [];
      let nextPageToken = "";
      let checkpoint = pageToken;
      let initialContinuation = false;
      let initialCheckpoint: Record<string, unknown> = {};
      if (pageToken) {
        nextPageToken = pageToken;
        let pages = 0;
        do {
          pages += 1;
          const url = new URL("https://www.googleapis.com/drive/v3/changes");
          url.searchParams.set("pageToken", nextPageToken);
          url.searchParams.set("pageSize", "1000");
          url.searchParams.set(
            "fields",
            `nextPageToken,newStartPageToken,changes(removed,fileId,file(${GOOGLE_FILE_FIELDS}))`
          );
          url.searchParams.set("includeItemsFromAllDrives", "true");
          url.searchParams.set("supportsAllDrives", "true");
          if (driveId) url.searchParams.set("driveId", driveId);
          const page = await jsonRequest<Record<string, unknown>>(
            client,
            url.toString(),
            token.active.accessToken,
            ["googleapis.com"]
          );
          for (const change of valueArray(page, "changes")) {
            const fileId = String(change.fileId ?? "");
            const file = change.file as Record<string, unknown> | undefined;
            if (change.removed || file?.trashed) {
              if (fileId) deletedRemoteIds.push(fileId);
              continue;
            }
            if (!file) continue;
            const mimeType = String(file.mimeType ?? "");
            const parents = Array.isArray(file.parents)
              ? (file.parents as string[])
              : [];
            if (folderId) {
              const inScope = parents.some((parent) => folderIds.has(parent));
              if (!inScope) {
                if (fileId) deletedRemoteIds.push(fileId);
                continue;
              }
              if (mimeType === "application/vnd.google-apps.folder") {
                const discoveredFolderId = String(file.id ?? "");
                if (discoveredFolderId) folderIds.add(discoveredFolderId);
                continue;
              }
            }
            const normalized = await googleFileArtifact(
              client,
              token.active.accessToken,
              file
            );
            if (normalized.artifact) artifacts.push(normalized.artifact);
            if (normalized.skipped) skipped.push(normalized.skipped);
          }
          nextPageToken = String(page.nextPageToken ?? "");
          checkpoint = String(page.newStartPageToken ?? checkpoint);
        } while (nextPageToken && pages < PROVIDER_PAGE_BUDGET);
        if (nextPageToken) checkpoint = nextPageToken;
      } else {
        let initialStartPageToken = String(
          applicationImport.checkpoint.googleStartPageToken ?? ""
        );
        if (!initialStartPageToken) {
          const startUrl = new URL(
            "https://www.googleapis.com/drive/v3/changes/startPageToken"
          );
          startUrl.searchParams.set("supportsAllDrives", "true");
          if (driveId) startUrl.searchParams.set("driveId", driveId);
          const start = await jsonRequest<Record<string, unknown>>(
            client,
            startUrl.toString(),
            token.active.accessToken,
            ["googleapis.com"]
          );
          initialStartPageToken = String(start.startPageToken ?? "");
        }
        // A selected folder means its complete tree, not only its immediate
        // children. Breadth-first enumeration stays bounded and records the
        // discovered folder IDs in the opaque checkpoint for change filtering.
        const foldersToVisit = [
          ...((applicationImport.checkpoint.googleFoldersToVisit as string[] | undefined) ??
            (folderId ? [folderId] : [""])),
        ];
        const visitedFolders = new Set<string>(
          (applicationImport.checkpoint.googleVisitedFolders as string[] | undefined) ?? []
        );
        let parent: string | null =
          typeof applicationImport.checkpoint.googleCurrentParent === "string"
            ? applicationImport.checkpoint.googleCurrentParent
            : foldersToVisit.shift() ?? null;
        let pageTokenValue = String(
          applicationImport.checkpoint.googleInitialPageToken ?? ""
        );
        let pages = 0;
        while (parent !== null && pages < PROVIDER_PAGE_BUDGET) {
          if (parent) {
            visitedFolders.add(parent);
            folderIds.add(parent);
          }
          if (visitedFolders.size > 1000) {
            throw new Error("Google Drive folder scope exceeds 1000 folders");
          }
          pages += 1;
            const url = new URL("https://www.googleapis.com/drive/v3/files");
            url.searchParams.set("pageSize", "1000");
            url.searchParams.set(
              "q",
              parent
                ? `'${parent.replaceAll("'", "\\'")}' in parents and trashed = false`
                : "trashed = false"
            );
            url.searchParams.set(
              "fields",
              `nextPageToken,files(${GOOGLE_FILE_FIELDS})`
            );
            url.searchParams.set("supportsAllDrives", "true");
            url.searchParams.set("includeItemsFromAllDrives", "true");
            if (driveId) {
              url.searchParams.set("corpora", "drive");
              url.searchParams.set("driveId", driveId);
            }
            if (pageTokenValue) {
              url.searchParams.set("pageToken", pageTokenValue);
            }
            const page = await jsonRequest<Record<string, unknown>>(
              client,
              url.toString(),
              token.active.accessToken,
              ["googleapis.com"]
            );
            for (const file of valueArray(page, "files")) {
              if (
                folderId &&
                String(file.mimeType ?? "") ===
                  "application/vnd.google-apps.folder"
              ) {
                const childId = String(file.id ?? "");
                if (childId && !visitedFolders.has(childId)) {
                  foldersToVisit.push(childId);
                }
                continue;
              }
              const normalized = await googleFileArtifact(
                client,
                token.active.accessToken,
                file
              );
              if (normalized.artifact) artifacts.push(normalized.artifact);
              if (normalized.skipped) skipped.push(normalized.skipped);
            }
            pageTokenValue = String(page.nextPageToken ?? "");
          if (!pageTokenValue) parent = foldersToVisit.shift() ?? null;
        }
        if (parent !== null) {
          initialContinuation = true;
          initialCheckpoint = {
            googleCurrentParent: parent,
            googleInitialPageToken: pageTokenValue,
            googleFoldersToVisit: foldersToVisit,
            googleVisitedFolders: [...visitedFolders],
            folderIds: [...folderIds],
            googleStartPageToken: initialStartPageToken,
          };
        }
        if (!initialContinuation) {
          checkpoint = initialStartPageToken;
        }
      }
      return {
        artifacts,
        deletedRemoteIds,
        skipped,
        checkpoint: initialContinuation
          ? initialCheckpoint
          : {
              pageToken: checkpoint,
              ...(folderId ? { folderIds: [...folderIds] } : {}),
            },
        continuationRequired: Boolean(nextPageToken) || initialContinuation,
        refreshedCredentials: token.refreshed,
        metrics: observed.metrics(),
      };
    },
  };
}

export function createApplicationConnectorRegistry(
  client: ApplicationHttpClient = defaultHttpClient
): ApplicationConnectorRegistry {
  return {
    salesforce: salesforceConnector(client),
    servicenow: serviceNowConnector(client),
    slack: slackConnector(client),
    onedrive: oneDriveConnector(client),
    google_drive: googleDriveConnector(client),
  };
}

export const APPLICATION_CONNECTORS = createApplicationConnectorRegistry();

export async function discoverApplicationConnectionScopes(
  connection: Parameters<ApplicationConnector["discoverScopes"]>[0]["connection"],
  registry: ApplicationConnectorRegistry = APPLICATION_CONNECTORS,
  onCredentialsRefreshed?: Parameters<ApplicationConnector["discoverScopes"]>[0]["onCredentialsRefreshed"]
) {
  const connector = registry[connection.provider];
  if (!connector) {
    throw new Error(`No Connector is registered for ${connection.provider}`);
  }
  return connector.discoverScopes({ connection, onCredentialsRefreshed });
}

/** Best-effort remote revocation; local encrypted-secret deletion stays authoritative. */
export async function revokeApplicationConnectionCredentials(
  connection: Parameters<ApplicationConnector["discoverScopes"]>[0]["connection"],
  client: ApplicationHttpClient = defaultHttpClient
): Promise<void> {
  const secret = credentials(connection);
  let url: string | null = null;
  let body = "";
  let headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (connection.provider === "google_drive") {
    url = "https://oauth2.googleapis.com/revoke";
    body = new URLSearchParams({
      token: secret.refreshToken ?? secret.accessToken,
    }).toString();
  } else if (connection.provider === "slack") {
    url = "https://slack.com/api/auth.revoke";
    headers = { authorization: `Bearer ${secret.accessToken}` };
  } else if (connection.provider === "salesforce" && secret.instanceUrl) {
    const host = new URL(secret.instanceUrl).hostname;
    url = trustedUrl(`${secret.instanceUrl}/services/oauth2/revoke`, [host]);
    body = new URLSearchParams({ token: secret.accessToken }).toString();
  } else if (connection.provider === "servicenow" && secret.baseUrl) {
    const host = new URL(secret.baseUrl).hostname;
    url = trustedUrl(`${secret.baseUrl}/oauth_revoke.do`, [host]);
    body = new URLSearchParams({ token: secret.accessToken }).toString();
  }
  // Microsoft delegated tokens have no per-token Graph revocation endpoint.
  if (!url) return;
  const response = await client(url, { method: "POST", headers, body });
  if (!response.ok && response.status !== 400 && response.status !== 404) {
    throw new Error(`Provider revocation returned HTTP ${response.status}`);
  }
}
