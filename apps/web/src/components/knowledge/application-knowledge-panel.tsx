"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { useApplicationConnectedToast } from "@/components/knowledge/use-application-connected";
import { SlackBotDialog } from "@/components/knowledge/slack-bot-dialog";
import type {
  ApplicationImport,
  ApplicationSyncRun,
  ApplicationProvider,
} from "@agent-hub/core";
import { applicationConnectionOwnerType } from "@agent-hub/core";
import type { ApplicationScopeOption } from "@agent-hub/agent";
import {
  AppWindow,
  Copy,
  Maximize2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Unlink,
} from "lucide-react";
import { Settings2 } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@agent-hub/ui";
import {
  createApplicationImportAction,
  discoverApplicationScopesAction,
  deleteApplicationConnectionAction,
  deleteApplicationImportAction,
  getApplicationConnectionDeleteImpactAction,
  setApplicationImportAssistantsAction,
  setApplicationImportEnabledAction,
  syncApplicationImportNowAction,
  updateApplicationImportConfigurationAction,
} from "@/app/actions";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { useDiscardGuard } from "@/components/knowledge/use-discard-guard";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableColumnHeader } from "@/components/ui/table-column-header";
import { useColumnWidths, type TableColumnLayout } from "@/components/ui/table-columns";
import { TableOpenCell } from "@/components/ui/table-open-cell";
import { TableRowMenu } from "@/components/ui/table-menu";
import {
  applicationImportHref,
  applicationImportStatusLabel,
  applicationImportStatusTone,
} from "@/lib/application-import-documents";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ingestionStarted } from "@/lib/ingestion-bus";
import { toast } from "@/lib/toast";
import { countLabel } from "@/lib/pagination";
import { copyToClipboard } from "@/lib/clipboard";
import type { ApplicationOAuthAvailability } from "@/lib/application-oauth";
import type { PublicApplicationConnection } from "@/lib/application-connections";
import {
  APP_BRANDS,
  APP_BRAND_ORDER,
  AppBrandMark,
} from "@/components/ui/app-brand";

interface ProviderDefinition {
  provider: ApplicationProvider;
  /** Label and mark come from `APP_BRANDS`, so the console and the marketing
   *  shot cannot drift apart on what a provider is called or looks like. */
  label: string;
  description: string;
  auth: "oauth" | "configured_oauth";
}

const DESCRIPTIONS: Record<ApplicationProvider, string> = {
  salesforce: "Import published Salesforce Knowledge articles.",
  servicenow: "Import articles from ServiceNow Knowledge Management.",
  slack: "Import messages and threads from selected channels.",
  onedrive: "Import supported files from a drive or folder.",
  google_drive: "Import supported files from My Drive or a folder.",
  microsoft_mail: "Sends Human review requests from your mailbox; not a knowledge source.",
};

/** The two that authenticate against credentials an admin configured. */
const CONFIGURED_OAUTH: ApplicationProvider[] = ["salesforce", "servicenow"];

const PROVIDERS: ProviderDefinition[] = APP_BRAND_ORDER.map((provider) => ({
  provider,
  label: APP_BRANDS[provider].label,
  description: DESCRIPTIONS[provider],
  auth: CONFIGURED_OAUTH.includes(provider) ? "configured_oauth" : "oauth",
}));

const PROVIDER_BY_ID = Object.fromEntries(
  PROVIDERS.map((definition) => [definition.provider, definition])
) as Record<ApplicationProvider, ProviderDefinition>;

function when(value: string | null): string {
  if (!value) return "Never";
  // Same formatter as the rest of the Library: server and browser must agree
  // on the text or the row fails hydration.
  return formatDateTime(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The operation failed.";
}

interface OAuthSetupForm {
  connectionName: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

const EMPTY_OAUTH_SETUP: OAuthSetupForm = {
  connectionName: "",
  baseUrl: "",
  clientId: "",
  clientSecret: "",
};

function OAuthSetupDialog({
  provider,
  connectionId,
  initialName,
  onClose,
}: {
  provider: "salesforce" | "servicenow" | null;
  connectionId?: string;
  initialName?: string;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [form, setForm] = useState(() => ({
    ...EMPTY_OAUTH_SETUP,
    connectionName: initialName ?? "",
  }));
  const [isPending, startTransition] = useTransition();
  const definition = provider ? PROVIDER_BY_ID[provider] : null;
  const { requestClose, confirmDeleteModal } = useDiscardGuard({
    open: provider !== null,
    dirty:
      form.connectionName !== (initialName ?? "") ||
      form.baseUrl !== "" ||
      form.clientId !== "" ||
      form.clientSecret !== "",
    pending: isPending,
    onClose,
    description: "This connection has not been set up yet.",
  });

  const complete = Boolean(
    form.connectionName.trim() &&
      form.clientId.trim() &&
      form.clientSecret.trim() &&
      form.baseUrl.trim()
  );

  function submit() {
    if (!provider) return;
    const popup = window.open(
      "about:blank",
      "ciele-application-oauth",
      "popup,width=560,height=760"
    );
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/applications/oauth/${provider}/start`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              returnTo: pathname,
              connectionName: form.connectionName,
              loginUrl: form.baseUrl,
              baseUrl: form.baseUrl,
              clientId: form.clientId,
              clientSecret: form.clientSecret,
              connectionId,
            }),
          }
        );
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const result = (await response.json()) as { authorizationUrl: string };
        if (!popup) throw new Error("Allow pop-ups to continue authorization.");
        popup.location.href = result.authorizationUrl;
        onClose();
      } catch (error) {
        popup?.close();
        toast.error(errorMessage(error));
      }
    });
  }

  return (
    <>
    <Dialog open={provider !== null} onOpenChange={(open) => !open && requestClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect {definition?.label}</DialogTitle>
          <DialogDescription>
            Sign in through the provider. Tokens remain server-side and encrypted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="application-connection-name">Name of integration</Label>
            <Input
              id="application-connection-name"
              autoComplete="off"
              value={form.connectionName}
              onChange={(event) =>
                setForm({ ...form, connectionName: event.target.value })
              }
              placeholder={definition ? `${definition.label} knowledge` : "Knowledge connection"}
            />
            <p className="text-muted-foreground text-xs">
              A name that helps your Organization remember this connection.
            </p>
          </div>
          {provider ? (
            <div className="space-y-2">
              <Label htmlFor="application-base-url">Base URL</Label>
              <Input
                id="application-base-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={form.baseUrl}
                onChange={(event) =>
                  setForm({ ...form, baseUrl: event.target.value })
                }
                placeholder={
                  provider === "salesforce"
                    ? "https://login.salesforce.com"
                    : "https://your-instance.service-now.com"
                }
              />
              {provider === "salesforce" && (
                <p className="text-muted-foreground text-xs">
                  Use login.salesforce.com, test.salesforce.com, or your My Domain URL.
                </p>
              )}
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="application-client-id">OAuth client ID</Label>
            <Input
              id="application-client-id"
              spellCheck={false}
              value={form.clientId}
              onChange={(event) =>
                setForm({ ...form, clientId: event.target.value })
              }
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="application-client-secret">OAuth client secret</Label>
            <Input
              id="application-client-secret"
              type="password"
              value={form.clientSecret}
              onChange={(event) =>
                setForm({ ...form, clientSecret: event.target.value })
              }
              autoComplete="new-password"
            />
          </div>
          {provider === "servicenow" && (
            <p className="text-muted-foreground text-xs">
              Ciele uses ServiceNow OAuth Authorization Code. Your ServiceNow
              username and password are never stored in Ciele.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="button" disabled={isPending || !complete} onClick={submit}>
            <RollInText text={isPending ? "Connecting…" : "Connect"} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmDeleteModal}
    </>
  );
}

function providerConfigFields(
  provider: ApplicationProvider,
  config: Record<string, string>,
  setConfig: (next: Record<string, string>) => void,
  scopes: ApplicationScopeOption[],
  scopesLoading: boolean
) {
  const update = (key: string, value: string) =>
    setConfig({ ...config, [key]: value });
  const csvIds = (key: string) =>
    new Set((config[key] ?? "").split(",").filter(Boolean));
  /** Adds or removes `id` in the comma-separated list at `key`. */
  const toggleCsv = (key: string, id: string) => {
    const ids = csvIds(key);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    update(key, [...ids].join(","));
  };
  if (provider === "slack") {
    const selected = csvIds("channelIds");
    const channels = scopes.filter((scope) => scope.kind === "channel");
    return (
      <div className="space-y-2">
        <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm leading-none font-medium">Channels</legend>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
          {scopesLoading && (
            <p role="status" className="p-2 text-sm">
              Loading channels…
            </p>
          )}
          {!scopesLoading && channels.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">
              No Slack channels were found. Invite Ciele to a channel, then
              reopen this dialog.
            </p>
          )}
          {channels.map((scope) => {
            const isMember =
              scope.metadata.member !== false && scope.metadata.shared !== true;
            const isSelected = selected.has(scope.id);
            return (
              <label
                key={scope.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={!isMember && !isSelected}
                  onChange={() => toggleCsv("channelIds", scope.id)}
                />
                <span className="min-w-0 flex-1 truncate">{scope.label}</span>
                {!isMember && (
                  <span className="text-xs text-muted-foreground">
                    {scope.metadata.shared === true
                      ? "Slack Connect, not supported"
                      : "Invite Ciele first"}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="application-history-days">Initial history</Label>
            <Select
              value={config.historyDays ?? "180"}
              onValueChange={(value) => update("historyDays", value ?? "180")}
            >
              <SelectTrigger id="application-history-days" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
                <SelectItem value="180">180 days</SelectItem>
                <SelectItem value="all">All history</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Only channels Ciele has joined can be imported. Private channels appear once invited.
        </p>
      </div>
    );
  }
  if (provider === "onedrive" || provider === "google_drive") {
    const onedrive = provider === "onedrive";
    const label = onedrive ? "Drive or folder" : "My Drive, Shared Drive, or folder";
    const selectable = scopes.filter(
      (scope) => scope.kind === "drive" || scope.kind === "folder"
    );
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <Select
          value={config.scopeId ?? ""}
          onValueChange={(value) => {
            const scope = selectable.find((item) => item.id === value);
            if (!scope) return;
            setConfig({
              ...config,
              scopeId: scope.id,
              // OneDrive addresses the signed-in user's own drive as "me".
              driveId: String(scope.metadata.driveId ?? (onedrive ? "me" : "")),
              folderId: String(scope.metadata.folderId ?? ""),
            });
          }}
        >
          <SelectTrigger className="w-full" aria-label={label}><SelectValue placeholder={scopesLoading ? "Loading…" : onedrive ? "Select a drive or folder" : "Select a scope"} /></SelectTrigger>
          <SelectContent>
            {selectable.map((scope) => <SelectItem key={scope.id} value={scope.id}>{scope.kind === "folder" ? `Folder · ${scope.label}` : scope.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (provider === "salesforce") {
    const categories = scopes.filter((scope) => scope.kind === "category");
    const languages = scopes.filter((scope) => scope.kind === "language");
    const selected = csvIds("dataCategories");
    return (
      <>
        <div className="space-y-2">
          <Label htmlFor="application-language">Article language</Label>
          <Select
            value={config.language ?? languages[0]?.metadata.language?.toString() ?? "en_US"}
            onValueChange={(value) => update("language", value ?? "en_US")}
          >
            <SelectTrigger id="application-language" className="w-full">
              <SelectValue placeholder={scopesLoading ? "Loading…" : "Select a language"} />
            </SelectTrigger>
            <SelectContent>
              {languages.map((scope) => (
                <SelectItem
                  key={scope.id}
                  value={String(scope.metadata.language ?? scope.id.replace("language:", ""))}
                >
                  {scope.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* An org without data categories has nothing to filter by. */}
        {categories.length > 0 && (
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-sm leading-none font-medium">
              Data categories (optional)
            </legend>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
              {categories.map((scope) => (
                <label key={scope.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm">
                  <input type="checkbox" checked={selected.has(scope.id)} onChange={() => toggleCsv("dataCategories", scope.id)} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{scope.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </>
    );
  }
  const knowledgeBases = scopes.filter(
    (scope) => scope.kind === "knowledge_base"
  );
  const selectedKnowledgeBases = csvIds("knowledgeBaseIds");
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-sm leading-none font-medium">Knowledge bases</legend>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
        {scopesLoading && (
          <p role="status" className="p-2 text-sm">
            Loading knowledge bases…
          </p>
        )}
        {knowledgeBases.map((scope) => (
          <label key={scope.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm">
            <input type="checkbox" checked={selectedKnowledgeBases.has(scope.id)} onChange={() => toggleCsv("knowledgeBaseIds", scope.id)} />
            <span className="min-w-0 [overflow-wrap:anywhere]">{scope.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ImportDialog({
  connection,
  editingImport,
  assistants,
  contextAssistantId,
  onClose,
}: {
  connection: PublicApplicationConnection | null;
  editingImport?: ApplicationImport | null;
  assistants: Array<{ id: string; title: string }>;
  contextAssistantId?: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(editingImport?.name ?? "");
  const [cadence, setCadence] = useState<"manual" | "daily">(
    editingImport?.cadence ?? "daily"
  );
  const [assistantIds, setAssistantIds] = useState<string[]>(
    editingImport?.assistantIds ?? (contextAssistantId ? [contextAssistantId] : [])
  );
  const [config, setConfig] = useState<Record<string, string>>(() => {
    if (!editingImport) return {};
    const values = Object.fromEntries(
      Object.entries(editingImport.config).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(",") : String(value ?? ""),
      ])
    );
    if (editingImport.config.allHistory === true) values.historyDays = "all";
    return values;
  });
  const [scopes, setScopes] = useState<ApplicationScopeOption[]>([]);
  const [scopesLoading, setScopesLoading] = useState(connection !== null);
  const [isPending, startTransition] = useTransition();
  // A flag rather than a diff against the opening values: the Salesforce
  // language is filled in by discovery, and that is not the reader's edit.
  const [touched, setTouched] = useState(false);
  const { requestClose, confirmDeleteModal } = useDiscardGuard({
    open: connection !== null,
    dirty: touched,
    pending: isPending,
    onClose,
    description: editingImport
      ? "The changes to this import are not saved yet."
      : "This import has not been created yet.",
  });
  const editConfig = (next: Record<string, string>) => {
    setTouched(true);
    setConfig(next);
  };

  const definition = connection
    ? PROVIDER_BY_ID[connection.provider]
    : undefined;

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    discoverApplicationScopesAction(connection.id)
      .then((items) => {
        if (!cancelled) {
          setScopes(items);
          if (connection.provider === "salesforce") {
            const firstLanguage = items.find((item) => item.kind === "language");
            if (firstLanguage) {
              setConfig((current) =>
                current.language
                  ? current
                  : {
                      ...current,
                      language: String(
                        firstLanguage.metadata.language ??
                          firstLanguage.id.replace("language:", "")
                      ),
                    }
              );
            }
          }
        }
      })
      .catch((error) => {
        if (!cancelled) toast.error(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setScopesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  function submit() {
    if (!connection) return;
    const normalizedConfig: Record<string, unknown> = { ...config };
    if (connection.provider === "slack") {
      normalizedConfig.channelIds = (config.channelIds ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      normalizedConfig.allHistory = config.historyDays === "all";
      normalizedConfig.historyDays =
        config.historyDays === "all" ? 180 : Number(config.historyDays ?? 180);
    }
    if (connection.provider === "salesforce") {
      normalizedConfig.dataCategories = (config.dataCategories ?? "")
        .split(",")
        .filter(Boolean);
    }
    if (connection.provider === "servicenow") {
      normalizedConfig.knowledgeBaseIds = (config.knowledgeBaseIds ?? "")
        .split(",")
        .filter(Boolean);
    }
    startTransition(async () => {
      try {
        const common = {
          name: name || `${definition?.label ?? "Application"} knowledge`,
          assistantIds,
          cadence,
          config: normalizedConfig,
        };
        if (editingImport) {
          await updateApplicationImportConfigurationAction({
            ...common,
            importId: editingImport.id,
          });
          ingestionStarted();
          toast.success("Import updated and queued for synchronization.");
        } else {
          await createApplicationImportAction({
            ...common,
            connectionId: connection.id,
          });
          ingestionStarted();
          toast.success("Import created and queued for synchronization.");
        }
        onClose();
      } catch (error) {
        toast.error(errorMessage(error));
      }
    });
  }

  return (
    <>
    <Dialog open={connection !== null} onOpenChange={(open) => !open && requestClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {editingImport ? "Edit" : "Import from"} {definition?.label}
          </DialogTitle>
          <DialogDescription>
            Choose the content boundary and which assistants may answer from it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="application-import-name">Import name</Label>
            <Input
              id="application-import-name"
              autoComplete="off"
              value={name}
              onChange={(event) => {
                setTouched(true);
                setName(event.target.value);
              }}
              placeholder={`${definition?.label ?? "Application"} knowledge`}
            />
          </div>
          {connection &&
            providerConfigFields(
              connection.provider,
              config,
              editConfig,
              scopes,
              scopesLoading
            )}
          <div className="space-y-2">
            <Label>Synchronization</Label>
            <Select
              value={cadence}
              onValueChange={(value) => {
                setTouched(true);
                setCadence((value ?? "daily") as "manual" | "daily");
              }}
            >
              <SelectTrigger className="w-full" aria-label="Synchronization">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="manual">Manual only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Linked assistants</legend>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-2">
              {assistants.map((assistant) => {
                const checked = assistantIds.includes(assistant.id);
                return (
                  <label
                    key={assistant.id}
                    className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={assistant.id === contextAssistantId}
                      onChange={() => {
                        setTouched(true);
                        setAssistantIds(
                          checked
                            ? assistantIds.filter((id) => id !== assistant.id)
                            : [...assistantIds, assistant.id]
                        );
                      }}
                    />
                    <span className="min-w-0 truncate">{assistant.title}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
            Content is copied into Ciele. The linked Assistants can answer from it, without re-checking source permissions.
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending || assistantIds.length === 0}
            onClick={submit}
          >
            <RollInText
              text={
                isPending
                  ? editingImport
                    ? "Saving…"
                    : "Creating…"
                  : editingImport
                    ? "Save and sync"
                    : "Create import"
              }
            />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmDeleteModal}
    </>
  );
}

/** The Configured imports table, laid out like the Library's Websites table. */
const IMPORT_COLUMNS: TableColumnLayout[] = [
  { key: "name", width: 360, min: 200 },
  { key: "status", width: 190 },
  { key: "content", width: 130 },
  { key: "actions", width: 140, fixed: true },
];

function importScopeSummary(item: ApplicationImport): string {
  const config = item.config;
  const selected =
    (Array.isArray(config.channelIds) && config.channelIds) ||
    (Array.isArray(config.knowledgeBaseIds) && config.knowledgeBaseIds) ||
    (Array.isArray(config.dataCategories) && config.dataCategories) ||
    (typeof config.scopeId === "string" && [config.scopeId]) ||
    [];
  if (selected.length === 0) return "No provider scope selected";
  const labels = selected.map(String);
  return labels.length <= 3
    ? `Scope: ${labels.join(", ")}`
    : `Scope: ${labels.slice(0, 3).join(", ")} +${labels.length - 3}`;
}

export function ApplicationKnowledgePanel({
  connections,
  imports,
  assistants,
  contextAssistantId,
  currentMemberId,
  canEdit,
  canManageConnections,
  oauthAvailability,
  operationalState,
}: {
  connections: PublicApplicationConnection[];
  imports: ApplicationImport[];
  assistants: Array<{ id: string; title: string }>;
  contextAssistantId?: string;
  currentMemberId: string;
  canEdit: boolean;
  canManageConnections: boolean;
  oauthAvailability: ApplicationOAuthAvailability;
  operationalState: Record<
    string,
    { lastRun: ApplicationSyncRun | null; sourceCount: number }
  >;
}) {
  const pathname = usePathname();
  // The OAuth setup dialog: which provider, and the connection being
  // reconnected when it is not a new one.
  const [oauth, setOauth] = useState<{
    provider: "salesforce" | "servicenow";
    connectionId?: string;
    connectionName?: string;
  } | null>(null);
  const [slackBotConnection, setSlackBotConnection] = useState<PublicApplicationConnection | null>(null);
  // The import dialog: the connection it imports from, and the import being
  // edited (null for a new one).
  const [importing, setImporting] = useState<{
    connection: PublicApplicationConnection | null;
    editing: ApplicationImport | null;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  /** The row control that started the request in flight, for its label. */
  const [rowPending, setRowPending] = useState<string | null>(null);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const visibleImports = useMemo(
    () =>
      contextAssistantId
        ? imports.filter((item) => item.assistantIds.includes(contextAssistantId))
        : imports,
    [contextAssistantId, imports]
  );
  const availableImports = useMemo(
    () =>
      contextAssistantId
        ? imports.filter(
            (item) => !item.assistantIds.includes(contextAssistantId)
          )
        : [],
    [contextAssistantId, imports]
  );

  const importColumns = useColumnWidths("application-imports", IMPORT_COLUMNS);

  useApplicationConnectedToast("Application connected.");

  function connect(
    definition: ProviderDefinition,
    connectionId?: string,
    connectionName?: string
  ) {
    if (definition.auth === "configured_oauth") {
      setOauth({
        provider: definition.provider as "salesforce" | "servicenow",
        connectionId,
        connectionName,
      });
      return;
    }
    const params = new URLSearchParams({ returnTo: pathname });
    if (connectionId) params.set("connectionId", connectionId);
    const url = `/application-connect/${definition.provider}?${params}`;
    const popup = window.open(url, "ciele-application-oauth", "popup,width=560,height=760");
    if (!popup) window.location.assign(url);
  }

  /** `startsIngestion` also wakes the bottom-right activity card. */
  function run(
    operation: () => Promise<void>,
    success: string,
    startsIngestion = false,
    control: string | null = null
  ) {
    setRowPending(control);
    startTransition(async () => {
      try {
        await operation();
        if (startsIngestion) ingestionStarted();
        toast.success(success);
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setRowPending(null);
      }
    });
  }
  const busy = (id: string, action: string) =>
    isPending && rowPending === `${action}:${id}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Applications</h2>
        <p className="text-muted-foreground text-sm">
          Connect external systems directly to Ciele, choose what to import, and
          keep the resulting sources synchronized.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {PROVIDERS.map((definition) => {
          const providerConnections = connections.filter(
            (connection) => connection.provider === definition.provider
          );
          const availability = oauthAvailability[definition.provider];
          const ownerType = applicationConnectionOwnerType(definition.provider);
          const mayConnect =
            ownerType === "member" ? canEdit : canManageConnections;
          const alreadyConnected = providerConnections.some((connection) =>
            ownerType === "organization"
              ? true
              : connection.ownerMemberId === currentMemberId
          );
          return (
            <section
              key={definition.provider}
              className="rounded-xl border bg-card p-4"
            >
              <div className="flex items-start gap-3">
                <AppBrandMark provider={definition.provider} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{definition.label}</h3>
                    {mayConnect && (
                      <Button
                        size="sm"
                        variant={providerConnections.length > 0 ? "outline" : "default"}
                        disabled={alreadyConnected}
                        title={
                          alreadyConnected
                              ? `Only one ${definition.label} connection is allowed for this ${ownerType === "member" ? "Member" : "Organization"}.`
                            : !availability.configured
                              ? `Set up a connection to ${definition.label}`
                              : undefined
                        }
                        onClick={() => connect(definition)}
                      >
                        <Plus className="size-3.5" /> Connect
                      </Button>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {definition.description}
                  </p>
                </div>
              </div>
              {providerConnections.length > 0 && (
                <div className="mt-3 space-y-2 border-t pt-3">
                  {providerConnections.map((connection) => (
                    <div
                      key={connection.id}
                      className="bg-muted/40 flex items-center gap-2 rounded-lg px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {connection.name}
                          {connection.ownerType === "member" ? " · Personal" : ""}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {connection.status === "connected"
                            ? "Connected"
                            : connection.error || connection.status.replaceAll("_", " ")}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {countLabel(
                            imports.filter((item) => item.connectionId === connection.id)
                              .length,
                            "import"
                          )}{" "}
                          ·{" "}
                          {countLabel(
                            imports
                              .filter((item) => item.connectionId === connection.id)
                              .reduce(
                                (sum, item) =>
                                  sum + (operationalState[item.id]?.sourceCount ?? 0),
                                0
                              ),
                            "source"
                          )}
                        </span>
                        {connection.providerAccountId && (
                          <span className="text-muted-foreground block truncate text-xs">
                            {connection.providerAccountId}
                          </span>
                        )}
                        <span className="text-muted-foreground block truncate text-xs">
                          {connection.scopes.length > 0
                            ? connection.scopes.join(", ")
                            : "No scopes reported"}
                          {connection.lastConnectedAt
                            ? ` · Validated ${when(connection.lastConnectedAt)}`
                            : ""}
                        </span>
                      </span>
                      {(canEdit || canManageConnections) && (
                        <>
                          {connection.provider === "slack" && canManageConnections && (
                            <Button size="sm" variant="outline" onClick={() => setSlackBotConnection(connection)}>
                              Slack assistant
                            </Button>
                          )}
                          {canEdit && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Configure import" aria-label="Configure import"
                              onClick={() =>
                                setImporting({ connection, editing: null })
                              }
                            >
                              <Settings2 className="size-4" />
                            </Button>
                          )}
                          {(connection.ownerType === "organization"
                            ? canManageConnections
                            : connection.ownerMemberId === currentMemberId && canEdit) && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Reconnect" aria-label="Reconnect"
                              onClick={() =>
                                connect(definition, connection.id, connection.name)
                              }
                            >
                              <RefreshCw className="size-4" />
                            </Button>
                          )}
                          {(canManageConnections ||
                            (connection.ownerType === "member" &&
                              connection.ownerMemberId === currentMemberId &&
                              canEdit)) && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title="Delete connection" aria-label="Delete connection"
                              onClick={() =>
                                startTransition(async () => {
                                  try {
                                    const impact =
                                      await getApplicationConnectionDeleteImpactAction(
                                        connection.id
                                      );
                                    confirmDelete({
                                      title: `Delete “${connection.name}”?`,
                                      description: `This removes ${impact.imports} import${impact.imports === 1 ? "" : "s"}, ${impact.sources} source${impact.sources === 1 ? "" : "s"}, and ${impact.assistantLinks} Assistant link${impact.assistantLinks === 1 ? "" : "s"}.`,
                                      onConfirm: async () => {
                                        await deleteApplicationConnectionAction(
                                          connection.id
                                        );
                                        toast.success("Connection deleted.");
                                      },
                                    });
                                  } catch (error) {
                                    toast.error(errorMessage(error));
                                  }
                                })
                              }
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Configured imports</h3>
          <Badge variant="secondary">
            <RollingNumber value={visibleImports.length} />
          </Badge>
        </div>
        {visibleImports.length === 0 ? (
          <div className="text-muted-foreground rounded-xl border border-dashed px-4 py-8 text-center text-sm">
            Connect an application, then configure an import to add its content.
          </div>
        ) : (
          <TableCard className={isPending ? "opacity-60" : undefined}>
            <Table fixed>
              {importColumns.colGroup}
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableColumnHeader label="Name" resize={importColumns.handleFor("name")} />
                  <TableColumnHeader label="Status" resize={importColumns.handleFor("status")} />
                  <TableColumnHeader label="Content" resize={importColumns.handleFor("content")} />
                  <TableColumnHeader label="Actions" align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleImports.map((item) => {
                  const connection = connections.find(
                    (candidate) => candidate.id === item.connectionId
                  );
                  const provider = connection
                    ? PROVIDER_BY_ID[connection.provider]
                    : undefined;
                  const state = operationalState[item.id];
                  const lastRun = state?.lastRun;
                  const documentCount = state?.sourceCount ?? 0;
                  const href = applicationImportHref(item.id, contextAssistantId);
                  const editImport = () =>
                    setImporting({ connection: connection ?? null, editing: item });
                  const toggleEnabled = () =>
                    run(
                      () => setApplicationImportEnabledAction(item.id, !item.enabled),
                      item.enabled ? "Import paused." : "Import resumed."
                    );
                  // The toast only says the run was accepted; the activity
                  // card follows it from here on.
                  const syncNow = () =>
                    run(
                      () => syncApplicationImportNowAction(item.id),
                      "Synchronization queued.",
                      true
                    );
                  const deleteImport = () =>
                    confirmDelete({
                      title: `Delete “${item.name}”?`,
                      description:
                        "Every knowledge source synchronized by this import will also be deleted.",
                      onConfirm: async () => {
                        await deleteApplicationImportAction(item.id);
                        toast.success("Import deleted.");
                      },
                    });
                  const unlink =
                    contextAssistantId && item.assistantIds.length > 1
                      ? () =>
                          run(
                            () =>
                              setApplicationImportAssistantsAction(
                                item.id,
                                item.assistantIds.filter((id) => id !== contextAssistantId)
                              ),
                            "Import unlinked from this Assistant."
                          )
                      : null;
                  const syncing = item.status === "syncing";
                  return (
                    <TableRowMenu
                      key={item.id}
                      title={item.name}
                      actions={[
                        { label: "Open", icon: Maximize2, href },
                        {
                          label: "Copy ID",
                          icon: Copy,
                          // Toast by the result: the clipboard can be missing or refuse.
                          onSelect: () =>
                            void copyToClipboard(item.id, "ID copied.", "Could not copy the ID."),
                        },
                        canEdit && {
                          label: "Edit import",
                          icon: Settings2,
                          disabled: syncing,
                          onSelect: editImport,
                        },
                        canEdit && {
                          label: "Sync now",
                          icon: RefreshCw,
                          disabled: isPending || syncing || !item.enabled,
                          onSelect: syncNow,
                        },
                        canEdit && {
                          label: item.enabled ? "Pause" : "Resume",
                          icon: item.enabled ? Pause : Play,
                          disabled: isPending,
                          onSelect: toggleEnabled,
                        },
                        canEdit &&
                          unlink && { label: "Unlink from this Assistant", icon: Unlink, onSelect: unlink },
                        canEdit && {
                          label: "Delete",
                          icon: Trash2,
                          destructive: true,
                          onSelect: deleteImport,
                        },
                      ]}
                    >
                      <TableRow>
                        <TableCell className="align-top">
                          <TableOpenCell
                            href={href}
                            label={item.name}
                            className="flex items-start gap-2"
                          >
                            {connection ? (
                              <AppBrandMark
                                provider={connection.provider}
                                size="size-5"
                                className="mt-0.5 shrink-0"
                              />
                            ) : (
                              <AppWindow className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                            )}
                            <span className="min-w-0">
                              <Link
                                href={href}
                                className="press-text block truncate font-medium hover:underline"
                              >
                                {item.name}
                              </Link>
                              <span className="text-muted-foreground block truncate text-xs">
                                {provider?.label ?? "Application"} · {importScopeSummary(item)}
                              </span>
                              <span className="text-muted-foreground block truncate text-xs">
                                {countLabel(item.assistantIds.length, "Assistant")} ·{" "}
                                <span className="capitalize">{item.cadence}</span>
                              </span>
                              {item.error && (
                                <span className="block truncate text-xs text-red-700 dark:text-red-300">
                                  {item.error}
                                </span>
                              )}
                            </span>
                          </TableOpenCell>
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            tone={applicationImportStatusTone(item.status, item.enabled)}
                            title={item.error || undefined}
                          >
                            <RollInText text={applicationImportStatusLabel(item.status, item.enabled)} />
                          </Badge>
                          <span className="text-muted-foreground mt-1 block text-xs">
                            Last update: {when(item.lastSyncedAt)}
                          </span>
                          {item.enabled && item.nextSyncAt && (
                            <span className="text-muted-foreground block text-xs">
                              Next: {when(item.nextSyncAt)}
                            </span>
                          )}
                          {lastRun && (
                            <span
                              className="text-muted-foreground block truncate text-xs"
                              title={`${lastRun.discovered} discovered · ${lastRun.upserted} updated · ${lastRun.deleted} removed · ${lastRun.skipped} skipped · ${lastRun.failed} failed`}
                            >
                              {lastRun.upserted} updated · {lastRun.failed} failed
                            </span>
                          )}
                          {lastRun?.skippedReasons.length ? (
                            <span
                              className="block truncate text-xs text-amber-700 dark:text-amber-300"
                              title={lastRun.skippedReasons
                                .map(
                                  (reason) =>
                                    `${reason.remoteId ?? "unknown"} (${reason.reason.replaceAll("_", " ")})`
                                )
                                .join(" · ")}
                            >
                              {lastRun.skippedReasons.length} skipped
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="align-top">
                          <Link
                            href={href}
                            className="text-primary press-text font-medium hover:underline tabular-nums"
                          >
                            {countLabel(documentCount, "Document")}
                          </Link>
                        </TableCell>
                        <TableCell className="align-top text-right">
                          {canEdit && (
                            <span className="inline-flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isPending || syncing || !item.enabled}
                                onClick={syncNow}
                              >
                                <RefreshCw className="size-3.5" /> Sync now
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Edit import"
                                title={
                                  syncing ? "Wait for synchronization to finish" : "Edit import"
                                }
                                disabled={syncing}
                                onClick={editImport}
                              >
                                <Settings2 className="size-4" />
                              </Button>
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    </TableRowMenu>
                  );
                })}
              </TableBody>
            </Table>
          </TableCard>
        )}
      </section>

      {contextAssistantId && availableImports.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-semibold">Available organization imports</h3>
          <div className="grid gap-2 md:grid-cols-2">
            {availableImports.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-xl border px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {item.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {item.status}
                  </span>
                </span>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () =>
                          setApplicationImportAssistantsAction(item.id, [
                            ...item.assistantIds,
                            contextAssistantId,
                          ]),
                        "Import linked to this Assistant.",
                        false,
                        `link:${item.id}`
                      )
                    }
                  >
                    <RollInText
                      text={busy(item.id, "link") ? "Linking…" : "Link"}
                    />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <OAuthSetupDialog
        key={`oauth:${oauth?.provider ?? "closed"}:${oauth?.connectionId ?? "new"}`}
        provider={oauth?.provider ?? null}
        connectionId={oauth?.connectionId}
        initialName={oauth?.connectionName}
        onClose={() => setOauth(null)}
      />
      {slackBotConnection && (
        <SlackBotDialog key={`slack-bot:${slackBotConnection.id}`} connection={slackBotConnection}
          assistants={assistants} onClose={() => setSlackBotConnection(null)} />
      )}
      <ImportDialog
        key={`import:${importing?.connection?.id ?? "closed"}:${importing?.editing?.id ?? "new"}`}
        connection={importing?.connection ?? null}
        editingImport={importing?.editing ?? null}
        assistants={assistants}
        contextAssistantId={contextAssistantId}
        onClose={() => setImporting(null)}
      />
      {confirmDeleteModal}
    </div>
  );
}
