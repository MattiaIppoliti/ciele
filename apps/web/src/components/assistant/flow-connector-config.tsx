"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type {
  ConnectorAction,
  ConnectorActionSettings,
  ConnectorField,
  ConnectorProvider,
} from "@agent-hub/core";
import {
  CONNECTOR_PROVIDERS,
  CONNECTOR_PROVIDER_LABELS,
  connectorAction,
  connectorActionsFor,
  connectorConnectionIssue,
  connectorMissingScopes,
  connectorOutputVariable,
  connectorRunsInternalOnly,
  connectorSettingsIssue,
} from "@agent-hub/core";
import type { ConnectorError, ConnectorOutcome } from "@agent-hub/agent";
import type { ConnectorConnectionOption } from "@/lib/connector-options";
import { useApplicationConnectedToast } from "@/components/knowledge/use-application-connected";
import { AlertCircle, ExternalLink, KeyRound, Plug, RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  connectorOptionsAction,
  requestConnectorReconsentAction,
  runConnectorNodeAction,
  testConnectorConnectionAction,
} from "@/app/actions";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * The Connector action's configuration (spec #836, #839): provider →
 * Connection → catalogued action → its fields, plus the two sentences the
 * Visitor may read. Everything it renders comes from the catalogue in
 * `@agent-hub/core`; the only state of its own is which dynamic options have
 * been loaded. Reused by the form's action card and the canvas node panel.
 */

const OAUTH_POPUP = "ciele-application-oauth";

/** Providers whose consent starts with a plain GET (no customer-owned client). */
const DIRECT_OAUTH: ReadonlySet<ConnectorProvider> = new Set([
  "slack",
  "onedrive",
  "google_drive",
]);

export function ConnectorConfig({
  assistantId,
  settings,
  connections,
  onChange,
}: {
  assistantId: string;
  settings: ConnectorActionSettings | undefined;
  connections: ConnectorConnectionOption[];
  onChange: (patch: Partial<ConnectorActionSettings>) => void;
}) {
  useApplicationConnectedToast("Connection updated.");
  const provider = settings?.provider ?? connectorAction(settings?.action)?.provider ?? null;
  const action = connectorAction(settings?.action);
  const candidates = useMemo(
    () => (provider ? connections.filter((c) => c.provider === provider) : []),
    [connections, provider]
  );
  const connection = candidates.find((c) => c.id === settings?.connectionId) ?? null;
  const settingsIssue = connectorSettingsIssue(settings);
  const connectionIssue =
    action && settings?.connectionId
      ? connectorConnectionIssue(action, connection, { allowPersonal: true })
      : null;
  const missingScopes =
    action && connection ? connectorMissingScopes(action, connection.scopes) : [];

  function chooseProvider(next: ConnectorProvider) {
    if (next === provider) return;
    onChange({
      provider: next,
      connectionId: undefined,
      action: undefined,
      params: {},
    });
  }

  function chooseAction(key: string) {
    const next = connectorAction(key);
    if (!next) return;
    const params: Record<string, string> = {};
    for (const field of next.fields) {
      if (field.defaultValue !== undefined) params[field.name] = field.defaultValue;
    }
    onChange({ action: key, params });
  }

  const [, startReconsent] = useTransition();
  function reconsent() {
    if (!connection || !action) return;
    // Open the popup synchronously (a blocker-safe user gesture), then point
    // it at the start path the operation computes: the console and the API
    // agree on the scope union because they run the same operation.
    const popup = window.open("about:blank", OAUTH_POPUP, "popup,width=560,height=760");
    startReconsent(async () => {
      try {
        const { startPath } = await requestConnectorReconsentAction(connection.id, [action.key]);
        const url = new URL(startPath, window.location.origin);
        url.searchParams.set("returnTo", window.location.pathname);
        if (!popup) throw new Error("Allow pop-ups to continue authorization.");
        popup.location.href = url.toString();
      } catch (error) {
        popup?.close();
        toast.error(error instanceof Error ? error.message : "Could not start re-consent.");
      }
    });
  }

  function connectNew() {
    if (!provider) return;
    const params = new URLSearchParams({ returnTo: window.location.pathname });
    window.open(
      `/api/applications/oauth/${provider}/start?${params}`,
      OAUTH_POPUP,
      "popup,width=560,height=760"
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Provider</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {CONNECTOR_PROVIDERS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={provider === candidate}
              onClick={() => chooseProvider(candidate)}
              className={cn(
                "press flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                provider === candidate
                  ? "border-primary bg-primary/5 font-medium"
                  : "hover:bg-muted/50"
              )}
            >
              <Plug className="size-4 shrink-0 text-primary" />
              {CONNECTOR_PROVIDER_LABELS[candidate]}
            </button>
          ))}
        </div>
      </div>

      {provider && connectorRunsInternalOnly(provider) && (
        <p className="text-muted-foreground flex items-start gap-1.5 rounded-lg border px-3 py-2 text-xs">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {CONNECTOR_PROVIDER_LABELS[provider]} connections belong to one Member, so this action
          runs in the Preview and in Teammate chat under your own account. Publish will refuse the
          flow until an Organization-owned connection exists.
        </p>
      )}

      {provider && (
        <div className="space-y-1.5">
          <Label>Connection</Label>
          {candidates.length === 0 ? (
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                No {CONNECTOR_PROVIDER_LABELS[provider]} connection yet.
              </span>
              {DIRECT_OAUTH.has(provider) ? (
                <Button type="button" size="sm" variant="outline" onClick={connectNew}>
                  <KeyRound className="size-4" /> Connect
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  render={<Link href={`/assistants/${assistantId}/knowledge`} />}
                >
                  <ExternalLink className="size-4" /> Connect in Applications
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select
                value={settings?.connectionId ?? ""}
                onValueChange={(value) => onChange({ connectionId: (value as string) || undefined })}
              >
                <SelectTrigger className="bg-background min-w-0 flex-1" aria-label="Connection">
                  <SelectValue>
                    {(value: string) =>
                      candidates.find((c) => c.id === value)?.name || "Choose a connection…"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Choose a connection…</SelectItem>
                  {candidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                      {candidate.ownerType === "member" ? " (personal)" : ""}
                      {candidate.status !== "connected" ? ` · ${candidate.status.replace(/_/g, " ")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {DIRECT_OAUTH.has(provider) && (
                <Button type="button" size="sm" variant="ghost" onClick={connectNew}>
                  <KeyRound className="size-4" /> New
                </Button>
              )}
            </div>
          )}
          {connection && <TestConnectionControl connectionId={connection.id} />}
        </div>
      )}

      {provider && (
        <div className="space-y-1.5">
          <Label>Action</Label>
          <Select value={settings?.action ?? ""} onValueChange={(value) => value && chooseAction(value as string)}>
            <SelectTrigger className="bg-background" aria-label="Connector action">
              <SelectValue>
                {(value: string) => connectorAction(value)?.title || "Choose an action…"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {connectorActionsFor(provider).map((candidate) => (
                <SelectItem key={candidate.key} value={candidate.key}>
                  {candidate.title}
                  <span className="text-muted-foreground ml-2 text-xs">{candidate.effect}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {action && <p className="text-muted-foreground text-xs">{action.description}</p>}
        </div>
      )}

      {action && missingScopes.length > 0 && connection && (
        <div className="border-destructive/30 bg-destructive/5 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertCircle className="text-destructive size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            This connection lacks <code className="text-xs">{missingScopes.join(", ")}</code>.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={reconsent}>
            <RefreshCw className="size-4" /> Grant access
          </Button>
        </div>
      )}

      {action &&
        action.fields.map((field) => (
          <ConnectorFieldInput
            key={field.name}
            action={action}
            field={field}
            connectionId={connection?.id ?? null}
            params={settings?.params ?? {}}
            onChange={(value) =>
              onChange({ params: { ...(settings?.params ?? {}), [field.name]: value } })
            }
          />
        ))}

      {action && (
        <>
          {action.effect === "write" && (
            <div className="space-y-1.5">
              <Label>Success message</Label>
              <Textarea
                value={settings?.successMessage ?? ""}
                onChange={(e) => onChange({ successMessage: e.target.value })}
                placeholder="Your request was submitted successfully."
                rows={2}
                className="bg-background"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Failure message</Label>
            <Textarea
              value={settings?.failureMessage ?? ""}
              onChange={(e) => onChange({ failureMessage: e.target.value })}
              placeholder="Sorry, that request couldn't be completed right now."
              rows={2}
              className="bg-background"
            />
            <p className="text-muted-foreground text-xs">
              The provider&apos;s error never reaches the Visitor; you see it in Run node and in Alerts.
            </p>
          </div>
          <div className="text-muted-foreground rounded-lg border px-3 py-2 text-xs">
            Later actions can read{" "}
            {action.outputs.map((output, index) => (
              <span key={output.name}>
                {index > 0 && ", "}
                <code>{`{{${connectorOutputVariable(output.name)}}}`}</code>
              </span>
            ))}
            {" and "}
            <code>{`{{${connectorOutputVariable("ok")}}}`}</code>.
          </div>
        </>
      )}

      {(settingsIssue || connectionIssue) && (
        <p className="text-destructive flex items-center gap-1.5 text-xs">
          <AlertCircle className="size-3.5" /> {connectionIssue ?? settingsIssue}
        </p>
      )}
    </div>
  );
}

function ConnectorFieldInput({
  action,
  field,
  connectionId,
  params,
  onChange,
}: {
  action: ConnectorAction;
  field: ConnectorField;
  connectionId: string | null;
  params: Record<string, string>;
  onChange: (value: string) => void;
}) {
  const value = params[field.name] ?? field.defaultValue ?? "";
  const [options, setOptions] = useState<Array<{ value: string; label: string }> | null>(null);
  const [loading, startLoading] = useTransition();
  const [loadError, setLoadError] = useState<string | null>(null);
  const dependsOn = field.dynamic?.dependsOn;
  const loaderArg = field.dynamic?.arg ?? (dependsOn ? params[dependsOn] ?? "" : "");
  const listId = `connector-${action.key}-${field.name}`.replace(/\W/g, "-");

  function load() {
    if (!field.dynamic || !connectionId) return;
    const dynamic = field.dynamic;
    startLoading(async () => {
      const result = await connectorOptionsAction(connectionId, dynamic.loader, loaderArg);
      setOptions(result.options);
      setLoadError(result.error ? result.error.message : null);
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>
          {field.label}
          {field.required && <span className="text-destructive"> *</span>}
        </Label>
        {field.dynamic && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!connectionId || loading || (Boolean(dependsOn) && !loaderArg)}
            onClick={load}
            className="h-7 text-xs"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {options ? "Reload options" : "Load options"}
          </Button>
        )}
      </div>
      {field.type === "options" ? (
        <Select value={value} onValueChange={(next) => onChange(next as string)}>
          <SelectTrigger className="bg-background" aria-label={field.label}>
            <SelectValue>
              {(current: string) =>
                field.options?.find((option) => option.value === current)?.label ?? current
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "text" || field.type === "json" ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={field.type === "json" ? 5 : 3}
          className={cn("bg-background", field.type === "json" && "font-mono text-xs")}
          aria-label={field.label}
        />
      ) : (
        <>
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            list={options && options.length > 0 ? listId : undefined}
            className="bg-background"
            aria-label={field.label}
          />
          {options && options.length > 0 && (
            <datalist id={listId}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </datalist>
          )}
        </>
      )}
      {field.type === "json" && options && options.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Columns: {options.slice(0, 12).map((o) => o.value).join(", ")}
          {options.length > 12 ? ", …" : ""}
        </p>
      )}
      {field.hint && <p className="text-muted-foreground text-xs">{field.hint}</p>}
      {field.template && (
        <p className="text-muted-foreground text-xs">Template variables allowed.</p>
      )}
      {loadError && <p className="text-destructive text-xs">{loadError}</p>}
    </div>
  );
}

function TestConnectionControl({ connectionId }: { connectionId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error: ConnectorError | null } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(await testConnectorConnectionAction(connectionId));
          })
        }
      >
        {pending ? "Testing…" : "Test connection"}
      </Button>
      {result &&
        (result.ok ? (
          <span className="text-emerald-600">Connected</span>
        ) : (
          <span className="text-destructive">{result.error?.message ?? "Failed"}</span>
        ))}
    </div>
  );
}

/**
 * Run node for a Connector: one real call with sample template values. A write
 * asks first; the server action refuses an unconfirmed write as well, so the
 * dialog is a rule, not a courtesy.
 */
export function TestConnectorControl({ settings }: { settings: ConnectorActionSettings | undefined }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<ConnectorOutcome | null>(null);
  const action = connectorAction(settings?.action);
  const ready = Boolean(settings && action && connectorSettingsIssue(settings) === null);

  function run(confirmWrite: boolean) {
    if (!settings) return;
    setConfirming(false);
    start(async () => {
      try {
        setOutcome(await runConnectorNodeAction(settings, { confirmWrite }));
      } catch {
        setOutcome({
          ok: false,
          action: settings.action ?? null,
          status: null,
          error: { provider: action?.provider ?? null, code: "network", message: "The run could not be started.", status: null },
          outputs: {},
          excerpt: null,
        });
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {action?.effect === "write"
          ? "Runs the real call against the connected system with sample values. It will create or change data there."
          : "Runs the real call against the connected system with sample values."}
      </p>
      <Button
        type="button"
        variant={action?.effect === "write" ? "destructive" : "outline"}
        size="sm"
        disabled={!ready || pending}
        onClick={() => (action?.effect === "write" ? setConfirming(true) : run(false))}
      >
        {pending ? "Running…" : action?.effect === "write" ? "Run write action…" : "Run node"}
      </Button>
      {!ready && <p className="text-muted-foreground text-xs">Complete the configuration first.</p>}
      {outcome && (
        <div className="bg-muted/30 space-y-2 rounded-lg border p-3 text-xs">
          <p className="flex items-center gap-2">
            <Badge variant="outline" className={cn("rounded-full", outcome.ok ? "text-emerald-600" : "text-destructive")}>
              {outcome.ok ? "ok" : outcome.error?.code ?? "failed"}
            </Badge>
            {outcome.status !== null && <span className="font-mono">HTTP {outcome.status}</span>}
          </p>
          {outcome.error && <p className="text-destructive">{outcome.error.message}</p>}
          {Object.keys(outcome.outputs).length > 0 && (
            <div className="space-y-0.5">
              {Object.entries(outcome.outputs).map(([name, value]) => (
                <div key={name} className="font-mono break-all">
                  {`{{${connectorOutputVariable(name)}}}`} = {value || <span className="opacity-60">(empty)</span>}
                </div>
              ))}
            </div>
          )}
          {outcome.excerpt && (
            <pre className="bg-background max-h-40 overflow-auto rounded-md p-2">{outcome.excerpt}</pre>
          )}
        </div>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Run this write action?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {action?.title} will run for real in{" "}
            {action ? CONNECTOR_PROVIDER_LABELS[action.provider] : "the connected system"}, with
            sample values in place of template variables. Whatever it creates or changes stays there.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => run(true)}>
              Run it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
