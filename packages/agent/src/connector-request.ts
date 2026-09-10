import type {
  ApplicationConnection,
  ConnectorAction,
  ConnectorActionSettings,
  ConnectorLoader,
  ConnectorProvider,
} from "@agent-hub/core";
import {
  CONNECTOR_PROVIDER_LABELS,
  connectorAction,
  connectorConnectionIssue,
  connectorOutputVariable,
  connectorParamValue,
  connectorSettingsIssue,
  sealSecret,
} from "@agent-hub/core";
import type { ApplicationCredentials } from "./application-connectors";
import {
  ApplicationAuthorizationError,
  ApplicationRateLimitError,
  applicationCredentials,
  applicationRetryAfterMs,
  defaultApplicationHttpClient,
  refreshApplicationCredentials,
  trustedUrl,
  type ApplicationHttpClient,
  type ApplicationHttpResponse,
} from "./application-provider-http";
import { resolveTemplate, type TemplateContext } from "./template";
import { sampleContext } from "./api-request";

/**
 * The Connector action's execution core (spec #836, #839): one catalogued
 * action, one Application Connection, one HTTP call, one normalized outcome.
 *
 * Three callers share it, the way `api-request.ts` is shared by the Flow
 * action and the builder's Test request: the `connector` action handler in
 * `actions.ts`, the builder's Run node (`testConnectorAction`) and the node
 * panel's option loaders (`loadConnectorOptions`). Per-provider knowledge, how
 * a catalogued action becomes a URL and how a response becomes outputs, lives
 * in the three adapters below and nowhere else.
 *
 * Credentials are unsealed here and leave only as the outbound Authorization
 * header; every call goes through the Applications egress client (HTTPS only,
 * no redirects, bounded body) and through `refreshApplicationCredentials`, so
 * an expired token is refreshed and persisted rather than failing the turn.
 */

export type ConnectorErrorCode =
  | "not_configured"
  /** The step is configured; this surface has no Connector runtime to run it. */
  | "unavailable"
  /** A write the operator has not yet confirmed from the Run node. */
  | "unconfirmed"
  | "connection"
  | "authorization"
  | "scope"
  | "rate_limit"
  | "invalid_params"
  | "provider"
  | "network";

/** One shape for every provider's failure, what the run panel and the Alert show. */
export interface ConnectorError {
  provider: ConnectorProvider | null;
  code: ConnectorErrorCode;
  message: string;
  status: number | null;
  retryAfterMs?: number;
}

export interface ConnectorOutcome {
  ok: boolean;
  action: string | null;
  status: number | null;
  error: ConnectorError | null;
  /** The catalogued outputs, as strings, ready to become template variables. */
  outputs: Record<string, string>;
  /** Bounded response excerpt for the run panel, never the whole body. */
  excerpt: string | null;
}

/**
 * What the host lends the runtime: the connection row (credential sealed) and
 * the two writes a call may need. `turn.ts` binds it over the turn's Db; the
 * builder binds it over the session Db; tests pass fakes.
 */
export interface ConnectorRuntime {
  getConnection(id: string): Promise<ApplicationConnection | null>;
  /** Store refreshed credentials so the next call does not refresh again. */
  persistCredentials?(id: string, sealedCredentials: string): Promise<void>;
  /** A refresh or a 401 means the grant is gone: mark the row, raise the Alert. */
  markReauthorizationRequired?(
    connection: ApplicationConnection,
    message: string
  ): Promise<void>;
  /** Preview and Teammate turns may use a Member's personal Connection. */
  allowPersonal?: boolean;
}

export interface ConnectorDeps {
  client?: ApplicationHttpClient;
  signal?: AbortSignal;
  now?: () => number;
}

const CONNECTOR_EXCERPT_CHARS = 600;
const RECORDS_JSON_CHARS = 4000;
const OPTIONS_TTL_MS = 60_000;

/** The Alert `sourceKey` for one Connection, shared by the raise and the clear. */
export function connectorAlertKey(connectionId: string): string {
  return `application-connection:${connectionId}`;
}

interface PreparedRequest {
  url: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** A JSON body. */
  body?: unknown;
  /** A pre-encoded body (text upload, multipart), with its content type. */
  rawBody?: string;
  contentType?: string;
  /** Overrides the JSON `accept` header, for content downloads. */
  accept?: string;
  maxResponseBytes?: number;
  /**
   * False for a pre-authenticated URL the provider minted (a Graph download
   * URL): the Connection's bearer token must not travel to that host.
   */
  auth?: boolean;
  /**
   * A second hop the first response points at (a Graph download URL): the
   * adapter builds it from the response and names the extra host to trust.
   */
  then?: (response: ApplicationHttpResponse) => (PreparedRequest & { extraHost?: string }) | null;
}

interface ProviderAdapter {
  /** A read action of this provider, used to open a session for loaders and tests. */
  probeAction: string;
  /** Hosts the adapter may call for this connection; everything else is refused. */
  hosts(credentials: ApplicationCredentials, connection: ApplicationConnection): string[];
  /** A provider that reports failures inside a 200 body raises them here. */
  check?(response: ApplicationHttpResponse): void;
  prepare(
    action: ConnectorAction,
    params: Record<string, string>,
    credentials: ApplicationCredentials,
    connection: ApplicationConnection
  ): PreparedRequest;
  /** Outputs from a 2xx response; may throw `ConnectorFailure` for an in-body error. */
  parse(action: ConnectorAction, response: ApplicationHttpResponse): Record<string, string>;
  loaders: Partial<
    Record<
      ConnectorLoader,
      (
        arg: string,
        credentials: ApplicationCredentials,
        connection: ApplicationConnection
      ) => PreparedRequest & { parse: (body: unknown) => ConnectorOption[] }
    >
  >;
  testConnection(
    credentials: ApplicationCredentials,
    connection: ApplicationConnection
  ): PreparedRequest;
  headers?(credentials: ApplicationCredentials): Record<string, string>;
}

/** A provider-reported failure with a code the caller can act on. */
class ConnectorFailure extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "ConnectorFailure";
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function recordsJson(value: unknown): string {
  const json = JSON.stringify(value ?? []);
  return json.length > RECORDS_JSON_CHARS ? `${json.slice(0, RECORDS_JSON_CHARS)}…` : json;
}

function positiveLimit(raw: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function hostOf(base: string): string {
  return new URL(base).hostname.toLowerCase();
}

/* ---------------------------------- ServiceNow --------------------------------- */

const servicenow: ProviderAdapter = {
  probeAction: "servicenow.record.list",
  hosts: (credentials) => (credentials.baseUrl ? [hostOf(credentials.baseUrl)] : []),
  prepare(action, params, credentials) {
    const base = (credentials.baseUrl ?? "").replace(/\/$/, "");
    if (!base) throw new ConnectorFailure("connection", "ServiceNow base URL is missing");
    const table = serviceNowTable(params.table);
    const verb = action.key.split(".").pop();
    if (verb === "create") {
      return { url: `${base}/api/now/table/${table}`, method: "POST", body: jsonParams(params.fields) };
    }
    if (verb === "update" || verb === "delete") {
      const sysId = (params.sys_id ?? "").trim();
      if (!sysId) throw new ConnectorFailure("invalid_params", "Record sys_id is required");
      const url = `${base}/api/now/table/${table}/${encodeURIComponent(sysId)}`;
      return verb === "update"
        ? { url, method: "PATCH", body: jsonParams(params.fields) }
        : { url, method: "DELETE" };
    }
    const url = new URL(`${base}/api/now/table/${table}`);
    if (params.query?.trim()) url.searchParams.set("sysparm_query", params.query.trim());
    url.searchParams.set("sysparm_limit", String(positiveLimit(params.limit ?? "", 10, 100)));
    url.searchParams.set("sysparm_display_value", "false");
    return { url: url.toString(), method: "GET" };
  },
  parse(action, response): Record<string, string> {
    if (action.key.endsWith(".delete")) return { deleted: "true" };
    const body = parseJson(response.text) as { result?: unknown } | null;
    const result = body?.result;
    if (Array.isArray(result)) {
      const first = result[0] as Record<string, unknown> | undefined;
      return {
        count: String(result.length),
        first_sys_id: str(first?.sys_id),
        records: recordsJson(result),
      };
    }
    const record = (result ?? {}) as Record<string, unknown>;
    return { sys_id: str(record.sys_id), number: str(record.number) };
  },
  loaders: {
    "servicenow.tables": (_arg, credentials) => {
      const base = (credentials.baseUrl ?? "").replace(/\/$/, "");
      const url = new URL(`${base}/api/now/table/sys_db_object`);
      url.searchParams.set(
        "sysparm_query",
        "nameINincident,problem,change_request,sc_request,sc_req_item,sc_task,kb_knowledge,sys_user,cmdb_ci,task^ORnameSTARTSWITHu_^ORDERBYlabel"
      );
      url.searchParams.set("sysparm_fields", "name,label");
      url.searchParams.set("sysparm_limit", "300");
      return {
        url: url.toString(),
        method: "GET",
        parse: (body) =>
          rows(body).map((row) => ({
            value: str(row.name),
            label: row.label ? `${str(row.label)} (${str(row.name)})` : str(row.name),
          })),
      };
    },
    "servicenow.columns": (rawTable, credentials) => {
      const table = serviceNowTable(rawTable);
      const base = (credentials.baseUrl ?? "").replace(/\/$/, "");
      const url = new URL(`${base}/api/now/table/sys_dictionary`);
      url.searchParams.set(
        "sysparm_query",
        `name=${table}^elementISNOTEMPTY^internal_type!=collection^ORDERBYcolumn_label`
      );
      url.searchParams.set("sysparm_fields", "element,column_label");
      url.searchParams.set("sysparm_limit", "300");
      return {
        url: url.toString(),
        method: "GET",
        parse: (body) =>
          rows(body).map((row) => ({
            value: str(row.element),
            label: row.column_label ? `${str(row.column_label)} (${str(row.element)})` : str(row.element),
          })),
      };
    },
  },
  testConnection(credentials) {
    const base = (credentials.baseUrl ?? "").replace(/\/$/, "");
    return { url: `${base}/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id`, method: "GET" };
  },
};

function rows(body: unknown): Array<Record<string, unknown>> {
  const result = (body as { result?: unknown } | null)?.result;
  return Array.isArray(result) ? (result as Array<Record<string, unknown>>) : [];
}

/** A JSON-object param (already template-resolved), or an invalid_params failure. */
function jsonParams(raw: string | undefined): Record<string, unknown> {
  const text = (raw ?? "").trim();
  if (!text) return {};
  const parsed = parseJson(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConnectorFailure("invalid_params", "Fields must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/* ---------------------------------- Salesforce --------------------------------- */

const SALESFORCE_DEFAULT_VERSION = "v65.0";

function salesforceBase(credentials: ApplicationCredentials): string {
  const base = (credentials.instanceUrl ?? credentials.baseUrl ?? "").replace(/\/$/, "");
  if (!base) throw new ConnectorFailure("connection", "Salesforce instance URL is missing");
  return base;
}

function salesforceVersion(connection: ApplicationConnection): string {
  const pinned = connection.metadata?.apiVersion;
  return typeof pinned === "string" && /^v\d+\.\d+$/.test(pinned)
    ? pinned
    : SALESFORCE_DEFAULT_VERSION;
}

const salesforce: ProviderAdapter = {
  probeAction: "salesforce.contact.get",
  hosts: (credentials) => {
    const base = credentials.instanceUrl ?? credentials.baseUrl;
    return base ? [hostOf(base)] : [];
  },
  prepare(action, params, credentials, connection) {
    const base = salesforceBase(credentials);
    const fields = (params.fields ?? "Id").trim() || "Id";
    if (!/^[\w.]+(\s*,\s*[\w.]+)*$/.test(fields)) {
      throw new ConnectorFailure("invalid_params", "Fields must be a comma-separated list of field names");
    }
    const where = (params.where ?? "").trim();
    const limit = positiveLimit(params.limit ?? "", 10, 200);
    const object = action.fields.find(
      (field) => field.dynamic?.loader === "salesforce.fields"
    )?.dynamic?.arg;
    const soql = `SELECT ${fields} FROM ${object ?? "Contact"}${where ? ` WHERE ${where}` : ""} LIMIT ${limit}`;
    const url = new URL(`${base}/services/data/${salesforceVersion(connection)}/query`);
    url.searchParams.set("q", soql);
    return { url: url.toString(), method: "GET" };
  },
  parse(_action, response): Record<string, string> {
    const body = parseJson(response.text) as
      | { totalSize?: number; records?: Array<Record<string, unknown>> }
      | null;
    const records = Array.isArray(body?.records) ? body!.records! : [];
    return {
      count: String(body?.totalSize ?? records.length),
      first_id: str(records[0]?.Id),
      records: recordsJson(records.map(({ attributes: _attributes, ...rest }) => rest)),
      api_usage: response.headers.get("sforce-limit-info") ?? "",
    };
  },
  loaders: {
    "salesforce.fields": (object, credentials, connection) => ({
      url: `${salesforceBase(credentials)}/services/data/${salesforceVersion(connection)}/sobjects/${encodeURIComponent(object || "Contact")}/describe`,
      method: "GET",
      parse: (body) => {
        const fields = (body as { fields?: Array<Record<string, unknown>> } | null)?.fields;
        return Array.isArray(fields)
          ? fields.map((field) => ({
              value: str(field.name),
              label: field.label ? `${str(field.label)} (${str(field.name)})` : str(field.name),
            }))
          : [];
      },
    }),
  },
  testConnection(credentials, connection) {
    return {
      url: `${salesforceBase(credentials)}/services/data/${salesforceVersion(connection)}/limits`,
      method: "GET",
    };
  },
};

/* ------------------------------------ Slack ------------------------------------ */

const SLACK_AUTH_ERRORS = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
]);

const slack: ProviderAdapter = {
  probeAction: "slack.channel.list",
  check: (response) => void slackBody(response),
  hosts: () => ["slack.com"],
  prepare(action, params) {
    const verb = action.key;
    if (verb === "slack.message.post") {
      const channel = (params.channel ?? "").trim();
      const text = (params.text ?? "").trim();
      if (!channel) throw new ConnectorFailure("invalid_params", "Channel is required");
      if (!text) throw new ConnectorFailure("invalid_params", "Message is required");
      return { url: "https://slack.com/api/chat.postMessage", method: "POST", body: { channel, text } };
    }
    if (verb === "slack.channel.create") {
      const name = (params.name ?? "").trim();
      if (!name) throw new ConnectorFailure("invalid_params", "Channel name is required");
      return {
        url: "https://slack.com/api/conversations.create",
        method: "POST",
        body: { name, is_private: params.is_private === "true" },
      };
    }
    if (verb === "slack.channel.join") {
      const channel = (params.channel ?? "").trim();
      if (!channel) throw new ConnectorFailure("invalid_params", "Channel is required");
      return { url: "https://slack.com/api/conversations.join", method: "POST", body: { channel } };
    }
    const url = new URL("https://slack.com/api/conversations.list");
    url.searchParams.set("limit", String(positiveLimit(params.limit ?? "", 100, 1000)));
    url.searchParams.set("types", "public_channel");
    url.searchParams.set("exclude_archived", "true");
    return { url: url.toString(), method: "GET" };
  },
  parse(action, response): Record<string, string> {
    const body = slackBody(response);
    if (action.key === "slack.message.post") {
      return { ts: str(body.ts), channel: str(body.channel) };
    }
    if (action.key === "slack.channel.create" || action.key === "slack.channel.join") {
      const channel = (body.channel ?? {}) as Record<string, unknown>;
      return { id: str(channel.id), name: str(channel.name) };
    }
    const channels = Array.isArray(body.channels) ? (body.channels as Array<Record<string, unknown>>) : [];
    return {
      count: String(channels.length),
      channels: recordsJson(channels.map((c) => ({ id: c.id, name: c.name }))),
    };
  },
  loaders: {
    "slack.channels": () => ({
      url: "https://slack.com/api/conversations.list?limit=500&types=public_channel,private_channel&exclude_archived=true",
      method: "GET",
      parse: (body) => {
        const channels = (body as { channels?: Array<Record<string, unknown>> } | null)?.channels;
        return Array.isArray(channels)
          ? channels.map((c) => ({ value: str(c.id), label: `#${str(c.name)}` }))
          : [];
      },
    }),
  },
  testConnection: () => ({ url: "https://slack.com/api/auth.test", method: "POST", body: {} }),
  headers: () => ({ "content-type": "application/json; charset=utf-8" }),
};

/** Slack answers HTTP 200 with `ok:false`; that is the failure, not the status. */
function slackBody(response: ApplicationHttpResponse): Record<string, unknown> {
  const body = (parseJson(response.text) ?? {}) as Record<string, unknown>;
  if (body.ok === false) {
    const error = str(body.error);
    if (SLACK_AUTH_ERRORS.has(error)) {
      throw new ApplicationAuthorizationError(`Slack rejected the token (${error})`);
    }
    if (error === "missing_scope") {
      throw new ConnectorFailure("scope", `Slack: missing scope ${str(body.needed)}`.trim(), response.status);
    }
    if (error === "ratelimited") {
      throw new ConnectorFailure("rate_limit", "Slack rate limit reached", response.status, applicationRetryAfterMs(response.headers));
    }
    throw new ConnectorFailure("provider", `Slack: ${error || "request failed"}`, response.status);
  }
  return body;
}

/* ---------------------------------- OneDrive ----------------------------------- */

const GRAPH = "https://graph.microsoft.com/v1.0";
const CONTENT_MAX_BYTES = 1024 * 1024;
const CONTENT_MAX_CHARS = 20_000;
/** Where Graph's pre-authenticated download URLs live; anything else is not followed. */
const ONEDRIVE_DOWNLOAD_HOSTS = [".sharepoint.com", ".1drv.com", ".live.net", ".microsoft.com"];

/** An identifier-shaped param, or an `invalid_params` failure naming the field. */
function identifierParam(raw: string | undefined, pattern: RegExp, message: string): string {
  const value = (raw ?? "").trim();
  if (!pattern.test(value)) throw new ConnectorFailure("invalid_params", message);
  return value;
}

const ONEDRIVE_ID = /^[A-Za-z0-9!._-]{1,200}$/;
const GOOGLE_ID = /^[A-Za-z0-9_-]{1,200}$/;

/** `/me/drive/root` or `/me/drive/items/{id}`, from a folder param. */
function driveItemPath(folder: string | undefined): string {
  const id = (folder ?? "").trim();
  if (!id || id === "root") return "/me/drive/root";
  return `/me/drive/items/${encodeURIComponent(
    identifierParam(id, ONEDRIVE_ID, "Folder must be a OneDrive item id or root")
  )}`;
}

function driveItemId(raw: string | undefined, label = "File item id"): string {
  return identifierParam(raw, ONEDRIVE_ID, `${label} is required`);
}

function fileOutputs(item: Record<string, unknown>): Record<string, string> {
  return { id: str(item.id), name: str(item.name), web_url: str(item.webUrl ?? item.webViewLink) };
}

const onedrive: ProviderAdapter = {
  probeAction: "onedrive.file.find",
  hosts: () => ["graph.microsoft.com"],
  prepare(action, params) {
    const verb = action.key.split(".").pop();
    if (verb === "create") {
      const name = (params.name ?? "").trim();
      if (!name) throw new ConnectorFailure("invalid_params", "File name is required");
      return {
        url: `${GRAPH}${driveItemPath(params.folder)}:/${encodeURIComponent(name)}:/content`,
        method: "PUT",
        rawBody: params.content ?? "",
        contentType: "text/plain; charset=utf-8",
      };
    }
    if (verb === "copy") {
      const id = driveItemId(params.item_id);
      const target = driveItemPath(params.folder);
      const name = (params.name ?? "").trim();
      return {
        url: `${GRAPH}/me/drive/items/${encodeURIComponent(id)}/copy`,
        method: "POST",
        body: {
          parentReference:
            target === "/me/drive/root"
              ? { path: "/drive/root:" }
              : { id: target.slice("/me/drive/items/".length) },
          ...(name ? { name } : {}),
        },
      };
    }
    if (verb === "find") {
      const query = (params.query ?? "").trim();
      if (!query) throw new ConnectorFailure("invalid_params", "Search is required");
      const url = new URL(
        `${GRAPH}${driveItemPath(params.folder)}/search(q='${encodeURIComponent(query.replace(/'/g, "''"))}')`
      );
      url.searchParams.set("$select", "id,name,webUrl,size,lastModifiedDateTime");
      url.searchParams.set("$top", String(positiveLimit(params.limit ?? "", 10, 100)));
      return { url: url.toString(), method: "GET" };
    }
    const id = driveItemId(params.item_id);
    const item = `${GRAPH}/me/drive/items/${encodeURIComponent(id)}`;
    if (verb === "get_content") {
      return {
        url: `${item}?$select=id,name,size,@microsoft.graph.downloadUrl`,
        method: "GET",
        then: (response) => {
          const body = parseJson(response.text) as Record<string, unknown> | null;
          const downloadUrl = str(body?.["@microsoft.graph.downloadUrl"]);
          if (!downloadUrl) return null;
          // Graph mints a pre-authenticated URL on a Microsoft storage host.
          // Only those hosts are followed, and the bearer token stays home.
          const host = new URL(downloadUrl).hostname.toLowerCase();
          if (!ONEDRIVE_DOWNLOAD_HOSTS.some((suffix) => host.endsWith(suffix))) {
            throw new ConnectorFailure("provider", `Refused a download host Graph should not name: ${host}`);
          }
          return {
            url: downloadUrl,
            method: "GET",
            accept: "*/*",
            auth: false,
            maxResponseBytes: CONTENT_MAX_BYTES,
            extraHost: host,
          };
        },
      };
    }
    if (verb === "get_metadata") {
      return {
        url: `${item}?$select=id,name,size,webUrl,lastModifiedDateTime`,
        method: "GET",
      };
    }
    if (verb === "share_link") {
      return {
        url: `${item}/createLink`,
        method: "POST",
        body: { type: params.type || "view", scope: params.scope || "organization" },
      };
    }
    return { url: item, method: "DELETE" };
  },
  parse(action, response): Record<string, string> {
    const verb = action.key.split(".").pop();
    if (verb === "delete") return { deleted: "true" };
    if (verb === "get_content") return { content: response.text.slice(0, CONTENT_MAX_CHARS) };
    const body = (parseJson(response.text) ?? {}) as Record<string, unknown>;
    if (verb === "copy") {
      return { status: response.status === 202 ? "accepted" : String(response.status), monitor_url: response.headers.get("location") ?? "" };
    }
    if (verb === "find") {
      const items = Array.isArray(body.value) ? (body.value as Array<Record<string, unknown>>) : [];
      return {
        count: String(items.length),
        first_id: str(items[0]?.id),
        items: recordsJson(items.map((i) => ({ id: i.id, name: i.name, webUrl: i.webUrl }))),
      };
    }
    if (verb === "share_link") {
      const link = (body.link ?? {}) as Record<string, unknown>;
      return { url: str(link.webUrl) };
    }
    return {
      ...fileOutputs(body),
      ...(verb === "get_metadata"
        ? { size: str(body.size), modified: str(body.lastModifiedDateTime) }
        : {}),
    };
  },
  loaders: {
    "onedrive.folders": () => ({
      url: `${GRAPH}/me/drive/root/children?$select=id,name,folder&$top=200`,
      method: "GET",
      parse: (body) => {
        const items = (body as { value?: Array<Record<string, unknown>> } | null)?.value;
        return [
          { value: "root", label: "Root" },
          ...(Array.isArray(items)
            ? items.filter((i) => i.folder).map((i) => ({ value: str(i.id), label: str(i.name) }))
            : []),
        ];
      },
    }),
  },
  testConnection: () => ({ url: `${GRAPH}/me/drive?$select=id`, method: "GET" }),
};

/* --------------------------------- Google Drive -------------------------------- */

const DRIVE = "https://www.googleapis.com/drive/v3";
const FILE_FIELDS = "id,name,mimeType,size,webViewLink,modifiedTime";

function driveFileId(raw: string | undefined, label = "File id"): string {
  return identifierParam(raw, GOOGLE_ID, `${label} is required`);
}

const googleDrive: ProviderAdapter = {
  probeAction: "google_drive.file.find",
  hosts: () => ["www.googleapis.com"],
  prepare(action, params) {
    const verb = action.key.split(".").pop();
    const folder = (params.folder ?? "").trim();
    if (folder) driveFileId(folder, "Folder");
    if (verb === "create") {
      const name = (params.name ?? "").trim();
      if (!name) throw new ConnectorFailure("invalid_params", "File name is required");
      // Random, so no content can contain the delimiter by construction.
      const boundary = `ciele-${crypto.randomUUID()}`;
      const metadata = JSON.stringify({ name, ...(folder ? { parents: [folder] } : {}) });
      const rawBody = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        metadata,
        `--${boundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "",
        params.content ?? "",
        `--${boundary}--`,
        "",
      ].join("\r\n");
      return {
        url: `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${FILE_FIELDS}`,
        method: "POST",
        rawBody,
        contentType: `multipart/related; boundary=${boundary}`,
      };
    }
    if (verb === "find") {
      const query = (params.query ?? "").trim();
      if (!query) throw new ConnectorFailure("invalid_params", "Search is required");
      // "Find files in folder": an empty folder means My Drive's root, not
      // everything shared with the account.
      const q = [
        "trashed = false",
        `name contains '${query.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`,
        `'${folder || "root"}' in parents`,
      ].join(" and ");
      const url = new URL(`${DRIVE}/files`);
      url.searchParams.set("q", q);
      url.searchParams.set("fields", `files(${FILE_FIELDS})`);
      url.searchParams.set("pageSize", String(positiveLimit(params.limit ?? "", 10, 100)));
      return { url: url.toString(), method: "GET" };
    }
    const id = driveFileId(params.file_id);
    const file = `${DRIVE}/files/${encodeURIComponent(id)}`;
    if (verb === "copy") {
      const name = (params.name ?? "").trim();
      return {
        url: `${file}/copy?fields=${FILE_FIELDS}`,
        method: "POST",
        body: { ...(name ? { name } : {}), ...(folder ? { parents: [folder] } : {}) },
      };
    }
    if (verb === "get_content") {
      return { url: `${file}?alt=media`, method: "GET", accept: "*/*", maxResponseBytes: CONTENT_MAX_BYTES };
    }
    if (verb === "get_metadata") return { url: `${file}?fields=${FILE_FIELDS}`, method: "GET" };
    if (verb === "share_link") {
      return {
        url: `${file}/permissions`,
        method: "POST",
        body: { role: params.role || "reader", type: "anyone" },
        // The permission response carries no link: read the file's view link
        // in a second hop, so the output is what Drive says, not a guess.
        then: () => ({ url: `${file}?fields=id,webViewLink`, method: "GET" }),
      };
    }
    return { url: file, method: "DELETE" };
  },
  parse(action, response): Record<string, string> {
    const verb = action.key.split(".").pop();
    if (verb === "delete") return { deleted: "true" };
    if (verb === "get_content") return { content: response.text.slice(0, CONTENT_MAX_CHARS) };
    const body = (parseJson(response.text) ?? {}) as Record<string, unknown>;
    if (verb === "find") {
      const files = Array.isArray(body.files) ? (body.files as Array<Record<string, unknown>>) : [];
      return {
        count: String(files.length),
        first_id: str(files[0]?.id),
        items: recordsJson(files.map((f) => ({ id: f.id, name: f.name, webViewLink: f.webViewLink }))),
      };
    }
    if (verb === "share_link") return { url: str(body.webViewLink) };
    return {
      ...fileOutputs(body),
      ...(verb === "get_metadata" ? { size: str(body.size), modified: str(body.modifiedTime) } : {}),
    };
  },
  loaders: {
    "google_drive.folders": () => ({
      url: `${DRIVE}/files?q=${encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and trashed = false")}&fields=files(id,name)&pageSize=200`,
      method: "GET",
      parse: (body) => {
        const files = (body as { files?: Array<Record<string, unknown>> } | null)?.files;
        return Array.isArray(files) ? files.map((f) => ({ value: str(f.id), label: str(f.name) })) : [];
      },
    }),
  },
  testConnection: () => ({ url: `${DRIVE}/about?fields=user`, method: "GET" }),
};

const ADAPTERS: Record<ConnectorProvider, ProviderAdapter> = {
  servicenow,
  salesforce,
  slack,
  onedrive,
  google_drive: googleDrive,
};

/* --------------------------------- Execution ---------------------------------- */

interface Session {
  connection: ApplicationConnection;
  credentials: ApplicationCredentials;
  adapter: ProviderAdapter;
  hosts: string[];
}

/**
 * Loads the Connection, unseals and refreshes its credentials, and persists a
 * refresh. Throws `ConnectorFailure` / `ApplicationAuthorizationError`.
 */
async function openSession(
  action: ConnectorAction,
  connectionId: string,
  runtime: ConnectorRuntime,
  client: ApplicationHttpClient
): Promise<Session> {
  const connection = await runtime.getConnection(connectionId);
  const issue = connectorConnectionIssue(action, connection, {
    allowPersonal: runtime.allowPersonal,
  });
  if (!connection) throw new ConnectorFailure("connection", issue ?? "The connection no longer exists");
  if (issue) {
    const scope = /lacks the scopes/.test(issue);
    throw new ConnectorFailure(scope ? "scope" : "connection", issue);
  }
  const stored = applicationCredentials(connection);
  const { active, refreshed } = await refreshApplicationCredentials(
    connection.provider,
    stored,
    client
  );
  if (refreshed && runtime.persistCredentials) {
    await runtime.persistCredentials(connection.id, sealSecret(JSON.stringify(refreshed)));
  }
  const adapter = ADAPTERS[action.provider];
  return { connection, credentials: active, adapter, hosts: adapter.hosts(active, connection) };
}

const MAX_HOPS = 2;

async function send(
  session: Session,
  prepared: PreparedRequest,
  client: ApplicationHttpClient,
  hosts: string[] = session.hosts,
  hop = 1
): Promise<ApplicationHttpResponse> {
  const url = trustedUrl(prepared.url, hosts);
  const hasBody = prepared.body !== undefined || prepared.rawBody !== undefined;
  const response = await client(url, {
    method: prepared.method,
    headers: {
      ...(prepared.auth === false
        ? {}
        : { authorization: `Bearer ${session.credentials.accessToken}` }),
      accept: prepared.accept ?? "application/json",
      ...(hasBody
        ? { "content-type": prepared.contentType ?? "application/json" }
        : {}),
      ...(session.adapter.headers?.(session.credentials) ?? {}),
    },
    body:
      prepared.rawBody !== undefined
        ? prepared.rawBody
        : prepared.body !== undefined
          ? JSON.stringify(prepared.body)
          : undefined,
    ...(prepared.maxResponseBytes ? { maxResponseBytes: prepared.maxResponseBytes } : {}),
  });
  if (response.status === 401) {
    throw new ApplicationAuthorizationError(`${CONNECTOR_PROVIDER_LABELS[session.connection.provider as ConnectorProvider]} rejected the token (401)`);
  }
  if (response.status === 429) {
    throw new ConnectorFailure("rate_limit", "Provider rate limit reached", 429, applicationRetryAfterMs(response.headers));
  }
  if (response.status === 403 && /REQUEST_LIMIT_EXCEEDED/.test(response.text)) {
    // Salesforce's daily API cap: no Retry-After, and not something a retry
    // inside this turn could wait out.
    throw new ConnectorFailure("rate_limit", "Salesforce API request limit exceeded", 403);
  }
  if (!response.ok) {
    throw new ConnectorFailure(
      "provider",
      providerErrorMessage(response) ?? `Provider responded ${response.status}`,
      response.status
    );
  }
  // A second hop the response points at (a download URL the provider minted):
  // trusted because the provider named it, bounded to one extra request.
  const next = hop < MAX_HOPS ? prepared.then?.(response) : null;
  if (next) {
    const extra = next.extraHost ? [...hosts, next.extraHost] : hosts;
    return send(session, next, client, extra, hop + 1);
  }
  return response;
}

/** The provider's own error text, shape by shape, never the whole body. */
function providerErrorMessage(response: ApplicationHttpResponse): string | null {
  const body = parseJson(response.text);
  if (Array.isArray(body) && body[0] && typeof body[0] === "object") {
    const first = body[0] as Record<string, unknown>;
    return [first.errorCode, first.message].filter(Boolean).map(str).join(": ") || null;
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const nested = record.error as Record<string, unknown> | string | undefined;
    if (typeof nested === "string") return nested;
    if (nested && typeof nested === "object") {
      return [nested.message, nested.detail].filter(Boolean).map(str).join(" ") || null;
    }
  }
  return null;
}

function resolveParams(
  action: ConnectorAction,
  settings: ConnectorActionSettings,
  context: TemplateContext
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const field of action.fields) {
    const raw = connectorParamValue(action, settings.params, field.name);
    // The escape mode follows the slot the value lands in: a JSON body, a SOQL
    // literal, an encoded query. A Visitor's words never change the query's
    // shape, only its values.
    params[field.name] = field.template
      ? resolveTemplate(
          raw,
          context,
          field.escape ?? (field.type === "json" ? "json-string" : "plain")
        )
      : raw;
  }
  return params;
}

/** A ServiceNow table name is an identifier; anything else is refused before egress. */
function serviceNowTable(raw: string | undefined): string {
  const table = (raw ?? "").trim();
  if (!/^[a-z][a-z0-9_]{0,79}$/i.test(table)) {
    throw new ConnectorFailure("invalid_params", "Table must be a ServiceNow table name");
  }
  return table;
}

/** A failed outcome in the one shape every caller reads. */
export function connectorFailure(
  provider: ConnectorProvider | null,
  action: string | null,
  code: ConnectorErrorCode,
  message: string,
  status: number | null = null,
  retryAfterMs?: number
): ConnectorOutcome {
  return {
    ok: false,
    action,
    status,
    error: { provider, code, message, status, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) },
    outputs: {},
    excerpt: null,
  };
}

/**
 * Runs one Connector action. Never throws: every failure is an outcome with a
 * code, so the handler can pick the Visitor's sentence and the run panel the
 * admin's detail. An authorization failure also marks the Connection through
 * the runtime, which is where the Alert is raised.
 */
export async function executeConnectorAction(
  settings: ConnectorActionSettings,
  context: TemplateContext,
  runtime: ConnectorRuntime,
  deps: ConnectorDeps = {}
): Promise<ConnectorOutcome> {
  const client = deps.client ?? defaultApplicationHttpClient;
  const action = connectorAction(settings.action);
  const provider = action?.provider ?? settings.provider ?? null;
  const settingsIssue = connectorSettingsIssue(settings);
  if (!action || settingsIssue) {
    return connectorFailure(provider, settings.action ?? null, "not_configured", settingsIssue ?? "Choose a connector action");
  }
  let session: Session | null = null;
  try {
    session = await openSession(action, settings.connectionId!, runtime, client);
    const prepared = session.adapter.prepare(
      action,
      resolveParams(action, settings, context),
      session.credentials,
      session.connection
    );
    const response = await send(session, prepared, client);
    const outputs = session.adapter.parse(action, response);
    return {
      ok: true,
      action: action.key,
      status: response.status,
      error: null,
      outputs,
      excerpt: response.text.slice(0, CONNECTOR_EXCERPT_CHARS) || null,
    };
  } catch (error) {
    // A refresh that the provider refused throws before `session` exists, and
    // it is the same fact as a 401 on the call itself: this Connection cannot
    // act until someone reconnects it. Mark it either way.
    if (error instanceof ApplicationAuthorizationError && runtime.markReauthorizationRequired) {
      const connection = session?.connection ?? (await runtime.getConnection(settings.connectionId!));
      if (connection) await runtime.markReauthorizationRequired(connection, error.message);
    }
    const described = describeThrown(action.provider, error);
    return connectorFailure(
      action.provider,
      action.key,
      described.code,
      described.message,
      described.status,
      described.retryAfterMs
    );
  }
}

/** The `templatePatch` a successful outcome contributes to later actions. */
export function connectorTemplatePatch(outcome: ConnectorOutcome): Record<string, string> {
  const patch: Record<string, string> = { [connectorOutputVariable("ok")]: String(outcome.ok) };
  for (const [name, value] of Object.entries(outcome.outputs)) {
    patch[connectorOutputVariable(name)] = value;
  }
  return patch;
}

/**
 * Run node: the same call the runtime would make, with sample template values.
 * The caller confirms write actions before calling this; the function does not
 * second-guess it, a confirmed write really writes.
 */
export async function testConnectorAction(
  settings: ConnectorActionSettings,
  runtime: ConnectorRuntime,
  deps: ConnectorDeps = {}
): Promise<ConnectorOutcome> {
  return executeConnectorAction(settings, sampleContext(), runtime, deps);
}

export interface ConnectorOption {
  value: string;
  label: string;
}

const optionsCache = new Map<string, { at: number; options: ConnectorOption[] }>();

/**
 * Values from the connected system for a dynamic field (tables, columns,
 * Salesforce fields, Slack channels). Cached per Connection + loader + arg for
 * a minute: the node panel asks on every open and the provider need not hear
 * about it each time.
 */
export async function loadConnectorOptions(
  loader: ConnectorLoader,
  connectionId: string,
  arg: string,
  runtime: ConnectorRuntime,
  deps: ConnectorDeps = {}
): Promise<{ options: ConnectorOption[]; error: ConnectorError | null }> {
  const now = deps.now ?? Date.now;
  const provider = loader.split(".")[0] as ConnectorProvider;
  // The loader name comes from the client. One it does not know is an error
  // outcome, not a thrown `undefined.probeAction` on the way to one.
  if (!(provider in ADAPTERS)) {
    return {
      options: [],
      error: { provider: null, code: "not_configured", message: `No loader ${loader}`, status: null },
    };
  }
  // The runtime's read is what scopes the id to the caller's Organization, so
  // it runs before the cache is consulted: a cached list must never answer for
  // an id the caller cannot see.
  const visible = await runtime.getConnection(connectionId);
  if (!visible) {
    return {
      options: [],
      error: { provider, code: "connection", message: "The connection no longer exists", status: null },
    };
  }
  const key = `${visible.organizationId}:${connectionId}:${loader}:${arg}`;
  const cached = optionsCache.get(key);
  if (cached && now() - cached.at < OPTIONS_TTL_MS) return { options: cached.options, error: null };
  const client = deps.client ?? defaultApplicationHttpClient;
  const probe = connectorAction(ADAPTERS[provider].probeAction)!;
  try {
    const session = await openSession(probe, connectionId, runtime, client);
    const build = session.adapter.loaders[loader];
    if (!build) return { options: [], error: { provider, code: "not_configured", message: `No loader ${loader}`, status: null } };
    const prepared = build(arg, session.credentials, session.connection);
    const response = await send(session, prepared, client);
    session.adapter.check?.(response);
    const options = prepared.parse(parseJson(response.text)).filter((option) => option.value);
    optionsCache.set(key, { at: now(), options });
    return { options, error: null };
  } catch (error) {
    const outcome = describeThrown(provider, error);
    return { options: [], error: outcome };
  }
}

/** Clears the option cache, for tests and for a re-consent that changes what a token can see. */
export function resetConnectorOptionsCache(): void {
  optionsCache.clear();
}

/** The catalogued test call: "Needs setup" also means "token dead". */
export async function testConnectorConnection(
  connectionId: string,
  runtime: ConnectorRuntime,
  deps: ConnectorDeps = {}
): Promise<{ ok: boolean; error: ConnectorError | null }> {
  const client = deps.client ?? defaultApplicationHttpClient;
  let provider: ConnectorProvider | null = null;
  try {
    const connection = await runtime.getConnection(connectionId);
    if (!connection) return { ok: false, error: { provider: null, code: "connection", message: "The connection no longer exists", status: null } };
    provider = connection.provider as ConnectorProvider;
    const probe = connectorAction(ADAPTERS[provider].probeAction)!;
    const session = await openSession(probe, connectionId, runtime, client);
    const response = await send(session, session.adapter.testConnection(session.credentials, session.connection), client);
    session.adapter.check?.(response);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: describeThrown(provider, error) };
  }
}

function describeThrown(provider: ConnectorProvider | null, error: unknown): ConnectorError {
  if (error instanceof ApplicationAuthorizationError) {
    return { provider, code: "authorization", message: error.message, status: 401 };
  }
  if (error instanceof ApplicationRateLimitError) {
    return { provider, code: "rate_limit", message: error.message, status: 429, retryAfterMs: error.retryAfterMs };
  }
  if (error instanceof ConnectorFailure) {
    return { provider, code: error.code, message: error.message, status: error.status, ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}) };
  }
  return { provider, code: "network", message: error instanceof Error ? error.message : "The request could not be completed", status: null };
}

/**
 * A `ConnectorRuntime` over a Db-like host: the shape `turn.ts` and the web
 * server actions bind. Reauthorization marks the row and raises the
 * `integration` Alert under `connectorAlertKey`; the OAuth callback clears it.
 */
export function dbConnectorRuntime(
  db: {
    getApplicationConnection(id: string): Promise<ApplicationConnection | null>;
    updateApplicationConnection(
      id: string,
      patch: { status?: ApplicationConnection["status"]; error?: string; sealedCredentials?: string }
    ): Promise<void>;
    raiseAlert(
      organizationId: string,
      input: { type: "integration"; title: string; detail: string; sourceKey?: string | null }
    ): Promise<unknown>;
  },
  organizationId: string,
  options: {
    allowPersonal?: boolean;
    /**
     * The invoking Member. A personal Connection is visible only to its owner:
     * "runs under your own account" means this Member's, never a colleague's.
     */
    memberId?: string | null;
  } = {}
): ConnectorRuntime {
  return {
    allowPersonal: options.allowPersonal,
    async getConnection(id) {
      const connection = await db.getApplicationConnection(id);
      // Never another Organization's row, whatever id a Flow carries; and a
      // Member-owned row only for the Member acting.
      if (!connection || connection.organizationId !== organizationId) return null;
      if (connection.ownerType === "member" && connection.ownerMemberId !== (options.memberId ?? null)) {
        return null;
      }
      return connection;
    },
    async persistCredentials(id, sealedCredentials) {
      await db.updateApplicationConnection(id, { sealedCredentials });
    },
    async markReauthorizationRequired(connection, message) {
      await db.updateApplicationConnection(connection.id, {
        status: "reauthorization_required",
        error: message,
      });
      await db.raiseAlert(organizationId, {
        type: "integration",
        title: `${connection.name} needs to be reconnected`,
        detail: `A Flow's Connector action could not use the ${connection.provider} connection "${connection.name}": ${message}. Reconnect it under Knowledge → Applications; Flows using it will fail until then.`,
        sourceKey: connectorAlertKey(connection.id),
      });
    },
  };
}
