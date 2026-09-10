import type {
  ApplicationConnection,
  ConnectorActionSettings,
  ConnectorProvider,
} from "./types";

/**
 * The Connector catalogue (spec #836, #839): what a Connector Flow Action can
 * do against each connected provider, as **data**.
 *
 * The runtime (`@agent-hub/agent`) has one adapter per provider that turns a
 * catalogued action plus its params into an HTTP call; the builder renders an
 * action's `fields` and loads its dynamic options; Publish validates a Flow
 * against it. All three read this one description, the way `api-catalog.ts`
 * lets the API-catalogue tools refuse an undescribed path before any request
 * is made. Nothing here performs I/O.
 *
 * Deliberately small: the observed actions of the reference platform for the three
 * institutional providers, no OpenAPI import, no triggers, no resource mapper.
 * Slack *Set do not disturb* is not offered (user-token semantics; it would
 * snooze the installing admin, never a Visitor).
 */

export const CONNECTOR_PROVIDERS: readonly ConnectorProvider[] = [
  "servicenow",
  "salesforce",
  "slack",
  "onedrive",
  "google_drive",
];

export const CONNECTOR_PROVIDER_LABELS: Record<ConnectorProvider, string> = {
  servicenow: "ServiceNow",
  salesforce: "Salesforce",
  slack: "Slack",
  onedrive: "OneDrive",
  google_drive: "Google Drive",
};

export function isConnectorProvider(value: unknown): value is ConnectorProvider {
  return (CONNECTOR_PROVIDERS as readonly unknown[]).includes(value);
}

/**
 * Providers whose Connections are personal grants (ADR-0021): a Drive action
 * runs under one Member's identity, so it may run only where that Member is
 * the one acting, Preview and Teammate chat, never in a published widget (#840).
 */
const INTERNAL_ONLY_PROVIDERS: ReadonlySet<ConnectorProvider> = new Set([
  "onedrive",
  "google_drive",
]);

export function connectorRunsInternalOnly(provider: ConnectorProvider): boolean {
  return INTERNAL_ONLY_PROVIDERS.has(provider);
}

export const CONNECTOR_INTERNAL_ONLY_REASON =
  "Drive connectors run only in Preview and Teammate chat until an Organization-owned connection exists";

/** Read actions run at once; write actions ask before Run node and default to review. */
export type ConnectorEffect = "read" | "write";

/**
 * Value lists loaded from the connected system after a Connection is chosen
 * (the reference platform's dynamic values). Each names what it returns.
 */
export type ConnectorLoader =
  | "servicenow.tables"
  | "servicenow.columns"
  | "salesforce.fields"
  | "slack.channels"
  | "onedrive.folders"
  | "google_drive.folders";

export interface ConnectorFieldDynamic {
  loader: ConnectorLoader;
  /** Another field of the same action whose value the loader needs (a table). */
  dependsOn?: string;
  /** A fixed loader argument (the Salesforce object an action is bound to). */
  arg?: string;
}

export type ConnectorFieldType = "string" | "text" | "options" | "json";

export interface ConnectorField {
  name: string;
  label: string;
  type: ConnectorFieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** Static options for `options` fields. */
  options?: Array<{ value: string; label: string }>;
  /** Options loaded from the connected system; the field stays free-text too. */
  dynamic?: ConnectorFieldDynamic;
  /** May carry `{{…}}` template variables. */
  template?: boolean;
  /**
   * How a substituted template value is escaped for the query language the
   * field is spliced into. A Visitor's message must never break out of a SOQL
   * string literal or add a clause to a ServiceNow encoded query.
   */
  escape?: "soql-string" | "servicenow-query";
  defaultValue?: string;
}

export interface ConnectorOutput {
  name: string;
  label: string;
}

export interface ConnectorAction {
  /** `<provider>.<noun>.<verb>`, stable, what a Flow stores. */
  key: string;
  provider: ConnectorProvider;
  title: string;
  description: string;
  effect: ConnectorEffect;
  /** OAuth scopes the Connection must hold; empty when the provider's grant is coarse. */
  requiredScopes: string[];
  fields: ConnectorField[];
  /** Values later actions may read as `{{connector.<name>}}`. */
  outputs: ConnectorOutput[];
}

const SERVICENOW_TABLE: ConnectorField = {
  name: "table",
  label: "Table",
  type: "string",
  required: true,
  placeholder: "incident",
  dynamic: { loader: "servicenow.tables" },
};

const SERVICENOW_SYS_ID: ConnectorField = {
  name: "sys_id",
  label: "Record sys_id",
  type: "string",
  required: true,
  template: true,
  placeholder: "{{connector.sys_id}} or a sys_id",
};

const SERVICENOW_FIELDS: ConnectorField = {
  name: "fields",
  label: "Fields (JSON)",
  type: "json",
  required: true,
  template: true,
  hint: "A JSON object of column → value. Template variables are allowed inside string values.",
  dynamic: { loader: "servicenow.columns", dependsOn: "table" },
  defaultValue: '{\n  "short_description": "{{workflow.message}}"\n}',
};

const LIMIT: ConnectorField = {
  name: "limit",
  label: "Limit",
  type: "string",
  placeholder: "10",
  defaultValue: "10",
};

function salesforceGet(object: string, noun: string, defaultFields: string): ConnectorAction {
  return {
    key: `salesforce.${noun}.get`,
    provider: "salesforce",
    title: `Get ${object} records`,
    description: `Query Salesforce ${object} records with an optional WHERE clause.`,
    effect: "read",
    requiredScopes: [],
    fields: [
      {
        name: "fields",
        label: "Fields",
        type: "string",
        required: true,
        defaultValue: defaultFields,
        hint: "Comma-separated field names.",
        dynamic: { loader: "salesforce.fields", arg: object },
      },
      {
        name: "where",
        label: "Where",
        type: "string",
        template: true,
        escape: "soql-string",
        placeholder: `Email = '{{user.email}}'`,
        hint: "SOQL WHERE clause without the keyword; put template variables inside quotes. Leave empty for the newest records.",
      },
      LIMIT,
    ],
    outputs: [
      { name: "count", label: "Record count" },
      { name: "first_id", label: "First record id" },
      { name: "records", label: "Records (JSON)" },
      { name: "api_usage", label: "API usage (Sforce-Limit-Info)" },
    ],
  };
}

const ONEDRIVE_FOLDER: ConnectorField = {
  name: "folder",
  label: "Folder",
  type: "string",
  placeholder: "root",
  defaultValue: "root",
  hint: "A folder item id, or root.",
  dynamic: { loader: "onedrive.folders" },
};

const ONEDRIVE_ITEM: ConnectorField = {
  name: "item_id",
  label: "File item id",
  type: "string",
  required: true,
  template: true,
  placeholder: "{{connector.id}} or an item id",
};

const GOOGLE_FOLDER: ConnectorField = {
  name: "folder",
  label: "Folder",
  type: "string",
  placeholder: "My Drive",
  hint: "A folder id; empty means My Drive.",
  dynamic: { loader: "google_drive.folders" },
};

const GOOGLE_FILE: ConnectorField = {
  name: "file_id",
  label: "File id",
  type: "string",
  required: true,
  template: true,
  placeholder: "{{connector.id}} or a file id",
};

const FILE_NAME: ConnectorField = {
  name: "name",
  label: "File name",
  type: "string",
  required: true,
  template: true,
  placeholder: "request-{{session.id}}.txt",
};

const FILE_CONTENT: ConnectorField = {
  name: "content",
  label: "Content",
  type: "text",
  required: true,
  template: true,
  defaultValue: "From {{user.name}}:\n{{workflow.message}}",
  hint: "Written as plain text.",
};

const FILE_OUTPUTS: ConnectorOutput[] = [
  { name: "id", label: "File id" },
  { name: "name", label: "File name" },
  { name: "web_url", label: "Link" },
];

const ONEDRIVE_WRITE = ["Files.ReadWrite"];
const GOOGLE_WRITE = ["https://www.googleapis.com/auth/drive.file"];

/** The seven file operations, once per Drive; only the ids and scopes differ. */
function driveActions(
  provider: "onedrive" | "google_drive",
  item: ConnectorField,
  folder: ConnectorField,
  writeScopes: string[]
): ConnectorAction[] {
  const label = CONNECTOR_PROVIDER_LABELS[provider];
  return [
    {
      key: `${provider}.file.create`,
      provider,
      title: "Create file",
      description: `Create a plain-text file in a ${label} folder.`,
      effect: "write",
      requiredScopes: writeScopes,
      fields: [folder, FILE_NAME, FILE_CONTENT],
      outputs: FILE_OUTPUTS,
    },
    {
      key: `${provider}.file.copy`,
      provider,
      title: "Copy file",
      description: `Copy a ${label} file into a folder.`,
      effect: "write",
      requiredScopes: writeScopes,
      fields: [item, folder, { ...FILE_NAME, required: false, placeholder: "Keep the original name" }],
      outputs:
        provider === "onedrive"
          ? [{ name: "status", label: "Copy status" }, { name: "monitor_url", label: "Progress URL" }]
          : FILE_OUTPUTS,
    },
    {
      key: `${provider}.file.find`,
      provider,
      title: "Find files in folder",
      description: `Search a ${label} folder by name.`,
      effect: "read",
      requiredScopes: [],
      fields: [
        folder,
        {
          name: "query",
          label: "Search",
          type: "string",
          required: true,
          template: true,
          placeholder: "{{workflow.message}}",
        },
        LIMIT,
      ],
      outputs: [
        { name: "count", label: "Match count" },
        { name: "first_id", label: "First match id" },
        { name: "items", label: "Matches (JSON)" },
      ],
    },
    {
      key: `${provider}.file.get_content`,
      provider,
      title: "Get file content",
      description: `Read a ${label} file as text (bounded).`,
      effect: "read",
      requiredScopes: [],
      fields: [item],
      outputs: [{ name: "content", label: "Content (text)" }],
    },
    {
      key: `${provider}.file.get_metadata`,
      provider,
      title: "Get file metadata",
      description: `Read a ${label} file's name, size, link and modified time.`,
      effect: "read",
      requiredScopes: [],
      fields: [item],
      outputs: [
        ...FILE_OUTPUTS,
        { name: "size", label: "Size (bytes)" },
        { name: "modified", label: "Modified at" },
      ],
    },
    {
      key: `${provider}.file.share_link`,
      provider,
      title: "Create share link",
      description: `Create a sharing link for a ${label} file.`,
      effect: "write",
      requiredScopes: writeScopes,
      fields: [
        item,
        provider === "onedrive"
          ? {
              name: "type",
              label: "Permission",
              type: "options",
              options: [
                { value: "view", label: "View" },
                { value: "edit", label: "Edit" },
              ],
              defaultValue: "view",
            }
          : {
              name: "role",
              label: "Permission",
              type: "options",
              options: [
                { value: "reader", label: "View" },
                { value: "writer", label: "Edit" },
              ],
              defaultValue: "reader",
            },
        ...(provider === "onedrive"
          ? [
              {
                name: "scope",
                label: "Who",
                type: "options" as const,
                options: [
                  { value: "organization", label: "People in the organization" },
                  { value: "anonymous", label: "Anyone with the link" },
                ],
                defaultValue: "organization",
              },
            ]
          : []),
      ],
      outputs: [{ name: "url", label: "Share link" }],
    },
    {
      key: `${provider}.file.delete`,
      provider,
      title: "Delete file",
      description: `Delete a ${label} file.`,
      effect: "write",
      requiredScopes: writeScopes,
      fields: [item],
      outputs: [{ name: "deleted", label: "Deleted (true/false)" }],
    },
  ];
}

export const CONNECTOR_ACTIONS: readonly ConnectorAction[] = [
  {
    key: "servicenow.record.create",
    provider: "servicenow",
    title: "Create record",
    description: "Insert a record into a ServiceNow table (an incident, a request…).",
    effect: "write",
    requiredScopes: [],
    fields: [SERVICENOW_TABLE, SERVICENOW_FIELDS],
    outputs: [
      { name: "sys_id", label: "Record sys_id" },
      { name: "number", label: "Record number" },
    ],
  },
  {
    key: "servicenow.record.update",
    provider: "servicenow",
    title: "Update record",
    description: "Patch fields on an existing ServiceNow record.",
    effect: "write",
    requiredScopes: [],
    fields: [SERVICENOW_TABLE, SERVICENOW_SYS_ID, SERVICENOW_FIELDS],
    outputs: [
      { name: "sys_id", label: "Record sys_id" },
      { name: "number", label: "Record number" },
    ],
  },
  {
    key: "servicenow.record.list",
    provider: "servicenow",
    title: "List records",
    description: "Query a ServiceNow table with an encoded query.",
    effect: "read",
    requiredScopes: [],
    fields: [
      SERVICENOW_TABLE,
      {
        name: "query",
        label: "Encoded query",
        type: "string",
        template: true,
        escape: "servicenow-query",
        placeholder: "active=true^caller_id.email={{user.email}}",
      },
      LIMIT,
    ],
    outputs: [
      { name: "count", label: "Record count" },
      { name: "first_sys_id", label: "First record sys_id" },
      { name: "records", label: "Records (JSON)" },
    ],
  },
  {
    key: "servicenow.record.delete",
    provider: "servicenow",
    title: "Delete record",
    description: "Delete one ServiceNow record by sys_id.",
    effect: "write",
    requiredScopes: [],
    fields: [SERVICENOW_TABLE, SERVICENOW_SYS_ID],
    outputs: [{ name: "deleted", label: "Deleted (true/false)" }],
  },
  salesforceGet("Contact", "contact", "Id, Name, Email, Phone"),
  salesforceGet("Case", "case", "Id, CaseNumber, Subject, Status, Priority"),
  salesforceGet("User", "user", "Id, Name, Email, Username"),
  salesforceGet("Product2", "product", "Id, Name, ProductCode, IsActive"),
  {
    key: "slack.message.post",
    provider: "slack",
    title: "Post message",
    description: "Post a message to a Slack channel.",
    effect: "write",
    requiredScopes: ["chat:write"],
    fields: [
      {
        name: "channel",
        label: "Channel",
        type: "string",
        required: true,
        placeholder: "C0123456789",
        dynamic: { loader: "slack.channels" },
      },
      {
        name: "text",
        label: "Message",
        type: "text",
        required: true,
        template: true,
        defaultValue: "New request from {{user.name}}: {{workflow.message}}",
      },
    ],
    outputs: [
      { name: "ts", label: "Message timestamp" },
      { name: "channel", label: "Channel id" },
    ],
  },
  {
    key: "slack.channel.create",
    provider: "slack",
    title: "Create channel",
    description: "Create a Slack channel.",
    effect: "write",
    // A private channel needs `groups:write`; required up front so "Needs
    // setup" fires before the first private create fails with missing_scope.
    requiredScopes: ["channels:manage", "groups:write"],
    fields: [
      {
        name: "name",
        label: "Channel name",
        type: "string",
        required: true,
        template: true,
        placeholder: "ticket-{{session.id}}",
      },
      {
        name: "is_private",
        label: "Visibility",
        type: "options",
        options: [
          { value: "false", label: "Public" },
          { value: "true", label: "Private" },
        ],
        defaultValue: "false",
      },
    ],
    outputs: [
      { name: "id", label: "Channel id" },
      { name: "name", label: "Channel name" },
    ],
  },
  {
    key: "slack.channel.join",
    provider: "slack",
    title: "Join public channel",
    description: "Join the bot to a public Slack channel.",
    effect: "write",
    requiredScopes: ["channels:join"],
    fields: [
      {
        name: "channel",
        label: "Channel",
        type: "string",
        required: true,
        dynamic: { loader: "slack.channels" },
      },
    ],
    outputs: [{ name: "id", label: "Channel id" }],
  },
  {
    key: "slack.channel.list",
    provider: "slack",
    title: "List public channels",
    description: "List the workspace's public channels.",
    effect: "read",
    requiredScopes: ["channels:read"],
    fields: [LIMIT],
    outputs: [
      { name: "count", label: "Channel count" },
      { name: "channels", label: "Channels (JSON)" },
    ],
  },
  // The two Drives (#840): personal Connections, so internal-only until an
  // Organization-owned mode exists; see connectorRunsInternalOnly.
  ...driveActions("onedrive", ONEDRIVE_ITEM, ONEDRIVE_FOLDER, ONEDRIVE_WRITE),
  ...driveActions("google_drive", GOOGLE_FILE, GOOGLE_FOLDER, GOOGLE_WRITE),
];

export function connectorAction(key: string | undefined | null): ConnectorAction | null {
  if (!key) return null;
  return CONNECTOR_ACTIONS.find((action) => action.key === key) ?? null;
}

export function connectorActionsFor(provider: ConnectorProvider): ConnectorAction[] {
  return CONNECTOR_ACTIONS.filter((action) => action.provider === provider);
}

/** The scopes an action needs that a Connection does not hold. */
export function connectorMissingScopes(
  action: ConnectorAction,
  granted: readonly string[]
): string[] {
  const have = new Set(granted.map((scope) => scope.trim()).filter(Boolean));
  return action.requiredScopes.filter((scope) => !have.has(scope));
}

/** Required fields the params leave blank. */
export function connectorMissingParams(
  action: ConnectorAction,
  params: Record<string, string> | undefined
): string[] {
  return action.fields
    .filter((field) => field.required && !(params?.[field.name] ?? field.defaultValue)?.trim())
    .map((field) => field.name);
}

/** The value a field runs with: the param, else its default, else "". */
export function connectorParamValue(
  action: ConnectorAction,
  params: Record<string, string> | undefined,
  name: string
): string {
  const field = action.fields.find((candidate) => candidate.name === name);
  return params?.[name] ?? field?.defaultValue ?? "";
}

/**
 * Whether a Connector action is configured enough to save from the builder:
 * a catalogued action and its required fields. The Connection is judged
 * separately (`connectorConnectionIssue`), because a saved Flow may outlive
 * the Connection it names.
 */
export function connectorSettingsIssue(
  settings: ConnectorActionSettings | undefined
): string | null {
  const action = connectorAction(settings?.action);
  if (!action) return "Choose a connector action";
  if (!settings?.connectionId) return "Choose a connection";
  const missing = connectorMissingParams(action, settings.params);
  if (missing.length > 0) {
    const labels = missing.map(
      (name) => action.fields.find((field) => field.name === name)?.label ?? name
    );
    return `Fill in ${labels.join(", ")}`;
  }
  return null;
}

/**
 * Why a Connection cannot serve an action, or null when it can. Publish and
 * the runtime both ask this, so a widget never runs what Publish would refuse.
 *
 * Personal (Member-owned) Connections are refused for a published Flow: a
 * widget acting at 03:00 under one Member's identity is the ADR-0001/0007
 * line applied to connectors. Preview and Teammate turns may pass `allowPersonal`.
 */
export function connectorConnectionIssue(
  action: ConnectorAction,
  connection: Pick<
    ApplicationConnection,
    "provider" | "status" | "scopes" | "ownerType"
  > | null,
  options: { allowPersonal?: boolean } = {}
): string | null {
  if (!connection) return "The connection no longer exists";
  if (connection.provider !== action.provider) {
    return `The connection is a ${connection.provider} connection, this action needs ${action.provider}`;
  }
  if (connectorRunsInternalOnly(action.provider) && !options.allowPersonal) {
    return CONNECTOR_INTERNAL_ONLY_REASON;
  }
  if (connection.ownerType === "member" && !options.allowPersonal) {
    return "A personal connection cannot run in a published flow";
  }
  if (connection.status === "reauthorization_required" || connection.status === "error") {
    return "The connection needs to be reconnected";
  }
  const missing = connectorMissingScopes(action, connection.scopes);
  if (missing.length > 0) return `The connection lacks the scopes: ${missing.join(", ")}`;
  return null;
}

/** The `{{connector.<name>}}` template variable an output lands in. */
export function connectorOutputVariable(name: string): string {
  return `connector.${name}`;
}
