import { describe, expect, it, vi } from "vitest";
import type {
  ApplicationConnection,
  ApplicationImport,
  ApplicationProvider,
} from "@agent-hub/core";
import {
  createApplicationConnectorRegistry,
  type ApplicationHttpClient,
  type ApplicationHttpResponse,
} from "./application-provider-connectors";

function response(body: unknown, status = 200): ApplicationHttpResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    text,
    bytes: new TextEncoder().encode(text),
  };
}

function connection(
  provider: ApplicationProvider,
  extra: Record<string, unknown> = {}
): ApplicationConnection {
  return {
    id: `connection-${provider}`,
    organizationId: "org-1",
    ownerType:
      provider === "onedrive" || provider === "google_drive"
        ? "member"
        : "organization",
    ownerMemberId:
      provider === "onedrive" || provider === "google_drive"
        ? "member-1"
        : null,
    provider,
    name: provider,
    status: "connected",
    sealedCredentials: `plain:${JSON.stringify({
      accessToken: "token",
      expiresAt: "2999-01-01T00:00:00.000Z",
      ...extra,
    })}`,
    scopes: [],
    providerAccountId: null,
    metadata: {},
    error: "",
    lastConnectedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function applicationImport(
  connectionId: string,
  config: Record<string, unknown> = {},
  checkpoint: Record<string, unknown> = {}
): ApplicationImport {
  return {
    id: `import-${connectionId}`,
    organizationId: "org-1",
    connectionId,
    collectionId: "collection-1",
    name: "Import",
    config,
    cadence: "daily",
    enabled: true,
    status: "idle",
    checkpoint,
    error: "",
    lastSyncedAt: null,
    nextSyncAt: null,
    reservedBytes: 0,
    assistantIds: ["assistant-1"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("built-in Application Connectors", () => {
  it("stops a Salesforce claim at its page budget and returns a durable cursor", async () => {
    let pages = 0;
    const client: ApplicationHttpClient = async () => {
      pages += 1;
      return response({
        articles: [],
        nextPageUrl: `/services/data/v65.0/support/knowledgeArticles?page=${pages + 1}`,
      });
    };
    const connector = createApplicationConnectorRegistry(client).salesforce!;
    const result = await connector.synchronize({
      connection: connection("salesforce", {
        instanceUrl: "https://acme.my.salesforce.com",
      }),
      applicationImport: applicationImport("connection-salesforce"),
      syncStartedAt: "2026-08-27T10:00:00.000Z",
      knownArtifacts: {},
    });
    expect(pages).toBe(5);
    expect(result.continuationRequired).toBe(true);
    expect(result.checkpoint.salesforceNextUrl).toContain("page=6");
    expect(result.checkpoint.scanStartedAt).toBe(
      "2026-08-27T10:00:00.000Z"
    );
  });

  it("persists a rotated token before later provider enumeration can fail", async () => {
    const persisted = vi.fn().mockResolvedValue(undefined);
    const client: ApplicationHttpClient = async (url) => {
      if (url.includes("oauth.v2.access")) {
        return response({
          ok: true,
          access_token: "rotated-access",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
        });
      }
      throw new Error("provider enumeration failed");
    };
    const connector = createApplicationConnectorRegistry(client).slack!;
    await expect(
      connector.discoverScopes({
        connection: connection("slack", {
          expiresAt: "2020-01-01T00:00:00.000Z",
          refreshToken: "old-refresh",
          clientId: "client",
        }),
        onCredentialsRefreshed: persisted,
      })
    ).rejects.toThrow("provider enumeration failed");
    expect(persisted).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "rotated-access",
        refreshToken: "rotated-refresh",
      })
    );
  });

  it("classifies Retry-After without exposing provider payloads", async () => {
    const client: ApplicationHttpClient = async () => ({
      status: 429,
      ok: false,
      headers: new Headers({ "retry-after": "120" }),
      text: JSON.stringify({ error: "secret provider detail" }),
    });
    const connector = createApplicationConnectorRegistry(client).salesforce!;
    await expect(
      connector.synchronize({
        connection: connection("salesforce", {
          instanceUrl: "https://acme.my.salesforce.com",
        }),
        applicationImport: applicationImport("connection-salesforce"),
        knownArtifacts: {},
      })
    ).rejects.toMatchObject({
      retryAfterMs: 120_000,
      message: "Provider rate limit reached",
    });
  });

  it("discovers only selectable scopes exposed by each provider", async () => {
    const client: ApplicationHttpClient = async (url) => {
      if (url.includes("dataCategoryGroups")) {
        return response({
          dataCategoryGroups: [
            {
              name: "Products",
              topCategories: [{ name: "Student", label: "Students" }],
            },
          ],
        });
      }
      if (url.includes("/query?")) {
        return response({
          records: [{ Language: "en_US" }, { Language: "it" }],
        });
      }
      if (url.includes("kb_knowledge_base")) {
        return response({ result: [{ sys_id: "kb-1", title: "IT Help" }] });
      }
      if (url.includes("conversations.list")) {
        return response({
          ok: true,
          channels: [{ id: "C01", name: "help", is_member: true }],
          response_metadata: { next_cursor: "" },
        });
      }
      if (url.includes("graph.microsoft.com/v1.0/me/drive?")) {
        return response({ id: "drive-1", name: "OneDrive" });
      }
      if (url.includes("graph.microsoft.com") && url.includes("/root/children")) {
        return response({ value: [{ id: "folder-1", name: "Guides", folder: {} }] });
      }
      if (url.includes("graph.microsoft.com")) return response({ value: [] });
      if (url.includes("/drive/v3/drives")) {
        return response({ drives: [{ id: "shared-1", name: "Shared" }] });
      }
      if (url.includes("/drive/v3/files")) {
        return response({
          files: [{ id: "g-folder", name: "Policies", parents: [] }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const registry = createApplicationConnectorRegistry(client);
    const scopes = await Promise.all([
      registry.salesforce!.discoverScopes({
        connection: connection("salesforce", {
          instanceUrl: "https://acme.my.salesforce.com",
        }),
      }),
      registry.servicenow!.discoverScopes({
        connection: connection("servicenow", {
          baseUrl: "https://acme.service-now.com",
        }),
      }),
      registry.slack!.discoverScopes({ connection: connection("slack") }),
      registry.onedrive!.discoverScopes({ connection: connection("onedrive") }),
      registry.google_drive!.discoverScopes({
        connection: connection("google_drive"),
      }),
    ]);

    expect(scopes[0].scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "category:Products:Student" }),
        expect.objectContaining({ id: "language:it" }),
      ])
    );
    expect(scopes[1].scopes).toEqual([
      expect.objectContaining({ id: "kb-1", kind: "knowledge_base" }),
    ]);
    expect(scopes[2].scopes).toEqual([
      expect.objectContaining({ id: "C01", kind: "channel" }),
    ]);
    expect(scopes[3].scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "folder:drive-1:folder-1" }),
      ])
    );
    expect(scopes[4].scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "drive:my_drive",
          metadata: { driveId: "", folderId: "root" },
        }),
        expect.objectContaining({ id: "drive:shared-1" }),
        expect.objectContaining({ kind: "folder" }),
      ])
    );
  });

  it("normalizes Salesforce Knowledge article detail", async () => {
    const client = vi.fn(async (url: string) =>
      url.includes("/detail/ka01")
        ? response({ id: "ka01", title: "Reset password", articleBody: "Open Settings." })
        : response({
            articles: [
              {
                id: "ka01",
                title: "Reset password",
                url: "/detail/ka01",
                lastPublishedDate: "2026-08-20T10:00:00Z",
              },
            ],
          })) satisfies ApplicationHttpClient;
    const registry = createApplicationConnectorRegistry(client);
    const conn = connection("salesforce", {
      instanceUrl: "https://acme.my.salesforce.com",
    });

    const result = await registry.salesforce!.synchronize({
      connection: conn,
      applicationImport: applicationImport(conn.id),
      knownArtifacts: {},
    });

    expect(result.artifacts[0]).toMatchObject({
      remoteId: "ka01",
      title: "Reset password",
      text: expect.stringContaining("Open Settings."),
    });
    const incremental = await registry.salesforce!.synchronize({
      connection: conn,
      applicationImport: applicationImport(conn.id),
      knownArtifacts: {
        ka01: {
          revision: "2026-08-20T10:00:00Z",
          contentHash: "known",
        },
      },
    });
    expect(incremental.artifacts).toEqual([]);
    expect(incremental.unchangedRemoteIds).toEqual(["ka01"]);
  });

  it("normalizes ServiceNow Knowledge HTML", async () => {
    const client: ApplicationHttpClient = async () =>
      response({
        result: [
          {
            sys_id: "sn01",
            number: "KB0001",
            short_description: "Connect VPN",
            text: "<p>Install the VPN client.</p>",
            sys_updated_on: "2026-08-20 10:00:00",
            permalink: "javascript:alert(1)",
          },
        ],
      });
    const registry = createApplicationConnectorRegistry(client);
    const conn = connection("servicenow", {
      baseUrl: "https://acme.service-now.com",
    });

    const result = await registry.servicenow!.synchronize({
      connection: conn,
      applicationImport: applicationImport(conn.id),
      knownArtifacts: {},
    });

    expect(result.artifacts[0]).toMatchObject({
      remoteId: "sn01",
      title: "Connect VPN",
      text: "Install the VPN client.",
      canonicalUrl:
        "https://acme.service-now.com/kb_view.do?sysparm_article=KB0001",
    });
  });

  it("normalizes Slack channel messages", async () => {
    const client: ApplicationHttpClient = async (url) =>
      url.includes("users.list")
        ? response({
            ok: true,
            members: [
              { id: "U01", profile: { display_name: "Alex Support" } },
            ],
            response_metadata: { next_cursor: "" },
          })
        : response({
            ok: true,
            messages: [
              {
                ts: "1787800000.000100",
                user: "U01",
                text: "Use the status page",
              },
            ],
            response_metadata: { next_cursor: "" },
          });
    const registry = createApplicationConnectorRegistry(client);
    const conn = connection("slack", { teamId: "T01" });

    const result = await registry.slack!.synchronize({
      connection: conn,
      applicationImport: applicationImport(conn.id, { channelIds: ["C01"] }),
      knownArtifacts: {},
    });

    expect(result.artifacts[0]).toMatchObject({
      remoteId: "C01:1787800000.000100",
      title: "Use the status page",
      text: expect.stringContaining("Alex Support"),
      metadata: { channelId: "C01", authorName: "Alex Support" },
    });
  });

  it("revisits an older Slack root for new replies and deletion", async () => {
    let deleted = false;
    const client: ApplicationHttpClient = async (url) => {
      if (url.includes("users.list")) {
        return response({ ok: true, members: [], response_metadata: { next_cursor: "" } });
      }
      if (url.includes("conversations.history")) {
        return response({ ok: true, messages: [], response_metadata: { next_cursor: "" } });
      }
      if (url.includes("conversations.replies")) {
        return deleted
          ? response({ ok: false, error: "message_not_found" })
          : response({
              ok: true,
              messages: [
                { ts: "1700000000.000100", user: "U1", text: "Old root" },
                { ts: "1700009999.000200", user: "U2", text: "New reply" },
              ],
              response_metadata: { next_cursor: "" },
            });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const connector = createApplicationConnectorRegistry(client).slack!;
    const conn = connection("slack", { teamId: "T01" });
    const imported = applicationImport(
      conn.id,
      { channelIds: ["C01"] },
      { latestByChannel: { C01: "1800000000.000000" } }
    );
    const knownArtifacts = {
      "C01:1700000000.000100": { revision: "old", contentHash: "hash" },
    };
    const refreshed = await connector.synchronize({
      connection: conn,
      applicationImport: imported,
      knownArtifacts,
    });
    expect(refreshed.artifacts[0]).toMatchObject({
      remoteId: "C01:1700000000.000100",
      text: expect.stringContaining("New reply"),
      revision: "1700000000.000100:1700009999.000200",
    });

    deleted = true;
    const removed = await connector.synchronize({
      connection: conn,
      applicationImport: imported,
      knownArtifacts,
    });
    expect(removed.deletedRemoteIds).toEqual(["C01:1700000000.000100"]);
  });

  it("continues a long Slack thread through a bounded durable reply cursor", async () => {
    let replyPage = 0;
    const root = {
      ts: "1700000000.000100",
      user: "U1",
      text: "Long root",
      reply_count: 6,
    };
    const client: ApplicationHttpClient = async (url) => {
      if (url.includes("users.list")) {
        return response({ ok: true, members: [], response_metadata: { next_cursor: "" } });
      }
      if (url.includes("conversations.history")) {
        return response({ ok: true, messages: [root], response_metadata: { next_cursor: "" } });
      }
      if (url.includes("conversations.replies")) {
        replyPage += 1;
        return response({
          ok: true,
          messages: [
            ...(replyPage === 1 ? [root] : []),
            {
              ts: `170000000${replyPage}.000200`,
              user: "U2",
              text: `Reply ${replyPage}`,
            },
          ],
          response_metadata: {
            next_cursor: replyPage < 6 ? `reply-page-${replyPage + 1}` : "",
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const connector = createApplicationConnectorRegistry(client).slack!;
    const conn = connection("slack", { teamId: "T01" });
    const first = await connector.synchronize({
      connection: conn,
      applicationImport: applicationImport(conn.id, { channelIds: ["C01"] }),
      knownArtifacts: {},
    });
    expect(replyPage).toBe(4);
    expect(first.continuationRequired).toBe(true);
    expect(first.checkpoint).toHaveProperty("slackPendingThread");
    expect(first.artifacts).toEqual([]);

    const second = await connector.synchronize({
      connection: conn,
      applicationImport: applicationImport(
        conn.id,
        { channelIds: ["C01"] },
        first.checkpoint
      ),
      knownArtifacts: {},
    });
    expect(replyPage).toBe(6);
    expect(second.artifacts).toEqual([
      expect.objectContaining({
        remoteId: "C01:1700000000.000100",
        text: expect.stringContaining("Reply 6"),
      }),
    ]);
    expect(second.checkpoint).not.toHaveProperty("slackPendingThread");
  });

  it("rotates Slack history fairly and reserves calls for old-thread revisits", async () => {
    const revisitedChannels: string[] = [];
    const client: ApplicationHttpClient = async (url) => {
      if (url.includes("users.list")) {
        return response({ ok: true, members: [], response_metadata: { next_cursor: "" } });
      }
      if (url.includes("conversations.history")) {
        const channel = new URL(url).searchParams.get("channel");
        return response({
          ok: true,
          messages: [],
          response_metadata: {
            next_cursor: channel === "C01" ? "more-c01-history" : "",
          },
        });
      }
      if (url.includes("conversations.replies")) {
        const parsed = new URL(url);
        const channel = parsed.searchParams.get("channel")!;
        const ts = parsed.searchParams.get("ts")!;
        revisitedChannels.push(channel);
        return response({
          ok: true,
          messages: [{ ts, user: "U1", text: `Known root in ${channel}` }],
          response_metadata: { next_cursor: "" },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const connector = createApplicationConnectorRegistry(client).slack!;
    const conn = connection("slack", { teamId: "T01" });
    const result = await connector.synchronize({
      connection: conn,
      applicationImport: applicationImport(conn.id, {
        channelIds: ["C01", "C02"],
      }),
      knownArtifacts: {
        "C01:1700000000.000100": { revision: "1", contentHash: "hash-1" },
        "C02:1700000000.000200": { revision: "1", contentHash: "hash-2" },
      },
    });

    expect(revisitedChannels).toEqual(["C01", "C02"]);
    expect(result.continuationRequired).toBe(true);
    expect(result.checkpoint.historyCursorByChannel).toMatchObject({
      C01: "more-c01-history",
    });
  });

  it("resumes Slack backfill at the first channel that could not spend budget", async () => {
    const historyChannels: string[] = [];
    const client: ApplicationHttpClient = async (url) => {
      if (url.includes("users.list")) {
        return response({ ok: true, members: [], response_metadata: { next_cursor: "" } });
      }
      if (url.includes("conversations.history")) {
        const channel = new URL(url).searchParams.get("channel")!;
        historyChannels.push(channel);
        return response({
          ok: true,
          messages: [],
          response_metadata: { next_cursor: `more-${channel}` },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const connector = createApplicationConnectorRegistry(client).slack!;
    const conn = connection("slack", { teamId: "T01" });
    const channelIds = ["C01", "C02", "C03", "C04", "C05"];
    const first = await connector.synchronize({
      connection: conn,
      applicationImport: applicationImport(conn.id, { channelIds }),
      knownArtifacts: {},
    });
    expect(historyChannels).toEqual(["C01", "C02", "C03"]);
    expect(first.checkpoint.slackChannelOffset).toBe(3);

    await connector.synchronize({
      connection: conn,
      applicationImport: applicationImport(
        conn.id,
        { channelIds },
        first.checkpoint
      ),
      knownArtifacts: {},
    });
    expect(historyChannels.slice(3)).toEqual(["C04", "C05", "C01"]);
  });

  it("walks a OneDrive delta page and extracts file bytes", async () => {
    const client: ApplicationHttpClient = async (url) =>
      url.includes("download.1drv.com")
        ? response("OneDrive content")
        : response({
            value: [
              {
                id: "drive01",
                name: "guide.txt",
                file: { mimeType: "text/plain" },
                webUrl: "https://onedrive.live.com/guide",
                eTag: "etag-1",
                "@microsoft.graph.downloadUrl":
                  "https://download.1drv.com/guide.txt",
              },
            ],
            "@odata.deltaLink":
              "https://graph.microsoft.com/v1.0/me/drive/root/delta?token=next",
          });
    const registry = createApplicationConnectorRegistry(client);
    const conn = connection("onedrive");

    const result = await registry.onedrive!.synchronize({
      connection: conn,
      applicationImport: applicationImport(conn.id),
      knownArtifacts: {},
    });

    expect(result.artifacts[0]).toMatchObject({
      remoteId: "drive01",
      title: "guide.txt",
      text: "OneDrive content",
      canonicalUrl: "https://onedrive.live.com/guide",
    });
    expect(result.checkpoint).toMatchObject({
      deltaLink: expect.stringContaining("token=next"),
    });
  });

  it("enumerates Google Drive files and records the change token", async () => {
    const calls: string[] = [];
    const client: ApplicationHttpClient = async (url) => {
      calls.push(url);
      if (url.includes("alt=media")) return response("Google Drive content");
      if (url.includes("startPageToken")) return response({ startPageToken: "token-2" });
      return response({
        files: [
          {
            id: "google01",
            name: "guide.txt",
            mimeType: "text/plain",
            modifiedTime: "2026-08-20T10:00:00Z",
            webViewLink: "https://drive.google.com/file/d/google01/view",
          },
        ],
      });
    };
    const registry = createApplicationConnectorRegistry(client);
    const conn = connection("google_drive");

    const result = await registry.google_drive!.synchronize({
      connection: conn,
      applicationImport: applicationImport(conn.id),
      knownArtifacts: {},
    });

    expect(result.artifacts[0]).toMatchObject({
      remoteId: "google01",
      title: "guide.txt",
      text: "Google Drive content",
      canonicalUrl: "https://drive.google.com/file/d/google01/view",
    });
    expect(result.checkpoint).toEqual({ pageToken: "token-2" });
    expect(calls.findIndex((url) => url.includes("startPageToken"))).toBeLessThan(
      calls.findIndex((url) => url.includes("/drive/v3/files"))
    );
  });

  it("keeps an incremental Shared Drive feed scoped to that drive", async () => {
    const urls: string[] = [];
    const client: ApplicationHttpClient = async (url) => {
      urls.push(url);
      return response({ changes: [], newStartPageToken: "token-3" });
    };
    const connector = createApplicationConnectorRegistry(client).google_drive!;
    const conn = connection("google_drive");

    await connector.synchronize({
      connection: conn,
      applicationImport: applicationImport(
        conn.id,
        { scopeId: "drive:shared-1", driveId: "shared-1", folderId: "" },
        { pageToken: "token-2" }
      ),
      knownArtifacts: {},
    });

    expect(new URL(urls[0]!).searchParams.get("driveId")).toBe("shared-1");
  });

  it("propagates a download Retry-After instead of recording a permanent skip", async () => {
    const client: ApplicationHttpClient = async (url) => {
      if (url.includes("alt=media")) {
        return {
          ...response("throttled", 429),
          headers: new Headers({ "retry-after": "45" }),
        };
      }
      return response({
        files: [
          {
            id: "google-throttled",
            name: "guide.txt",
            mimeType: "text/plain",
          },
        ],
      });
    };
    const connector = createApplicationConnectorRegistry(client).google_drive!;
    const conn = connection("google_drive");

    await expect(
      connector.synchronize({
        connection: conn,
        applicationImport: applicationImport(conn.id),
        knownArtifacts: {},
      })
    ).rejects.toMatchObject({ retryAfterMs: 45_000 });
  });
});
