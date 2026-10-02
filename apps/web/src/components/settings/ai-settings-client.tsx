"use client";
import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import {
  type ChangeEvent,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type {
  AnthropicWifFederatedConfig,
  AzureOpenAiFederatedConfig,
  GoogleVertexFederatedConfig,
  OpenAiCompatibleConfig,
  Provider,
  ProviderConnection,
  ProviderConnectionProvider,
} from "@agent-hub/core";
import { CloudCog, Key, Plus, Server, Trash2, User } from "lucide-react";
import { toast } from "@/lib/toast";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  createAnthropicWifFederatedConnectionAction,
  createAzureOpenAiFederatedConnectionAction,
  createGoogleVertexFederatedConnectionAction,
  createOpenAiCompatibleConnectionAction,
  createProviderConnectionAction,
  deleteProviderConnectionAction,
  testOpenAiCompatibleConnectionAction,
  updatePersonalAiSubscriptionsAllowedAction,
} from "@/app/actions";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Card } from "@agent-hub/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Hint } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import { LocalConnectorSettings } from "@/components/settings/local-connector-settings";
import type {
  LocalSubscriptionProvider,
  LocalSubscriptionStatus,
} from "@agent-hub/agent/client";
import { Switch } from "@/components/ui/motion-switch";
import { RollInText } from "@/components/motion/roll-in-text";

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  google: "Google (Gemini)",
  openai_compatible: "OpenAI-compatible (Ollama, vLLM, …)",
};

/** Providers the generic hosted-API-key dialog can connect. OpenAI-compatible
 *  endpoints have their own form (base URL + models, key optional). */
type ApiKeyProvider = Exclude<ProviderConnectionProvider, "azure_openai" | "openai_compatible">;
const BYOK_PROVIDERS: ApiKeyProvider[] = [
  "anthropic",
  "openai",
  "google",
  "ai_gateway",
  "elevenlabs",
];

type OpenAiCompatibleTestResult = Awaited<
  ReturnType<typeof testOpenAiCompatibleConnectionAction>
>;

const CONNECTION_PROVIDER_LABELS: Record<ProviderConnectionProvider, string> = {
  ...PROVIDER_LABELS,
  azure_openai: "Azure OpenAI",
  elevenlabs: "ElevenLabs (Voice)",
  ai_gateway: "AI Gateway (Anthropic, OpenAI, Google)",
};

function isGoogleVertexConfig(
  config: ProviderConnection["config"]
): config is GoogleVertexFederatedConfig {
  return "kind" in config && config.kind === "google_vertex";
}

function isAnthropicWifConfig(
  config: ProviderConnection["config"]
): config is AnthropicWifFederatedConfig {
  return "kind" in config && config.kind === "anthropic_wif";
}

function isAzureOpenAiConfig(
  config: ProviderConnection["config"]
): config is AzureOpenAiFederatedConfig {
  return "kind" in config && config.kind === "azure_openai";
}

function isOpenAiCompatibleConfig(
  config: ProviderConnection["config"]
): config is OpenAiCompatibleConfig {
  return "kind" in config && config.kind === "openai_compatible";
}

const EMPTY_VERTEX = {
  displayName: "",
  projectId: "",
  location: "europe-west4",
  workloadIdentityAudience: "",
  serviceAccountEmail: "",
};
const EMPTY_ANTHROPIC = {
  displayName: "",
  workloadIdentityAudience: "",
  organizationId: "",
  workspaceId: "",
};
const EMPTY_AZURE = {
  displayName: "",
  tenantId: "",
  endpoint: "",
  deployment: "",
  clientId: "",
  audience: "",
};
const EMPTY_COMPAT = {
  displayName: "",
  baseUrl: "",
  apiKey: "",
  chatModel: "",
  embeddingModel: "",
};

type ConnectDialog = "key" | "vertex" | "anthropic" | "azure" | "compat";

/** `value` + `onChange` for one string field of a form-state object. */
function bindField<T extends Record<string, string>>(
  form: T,
  setForm: Dispatch<SetStateAction<T>>,
) {
  return (key: keyof T & string) => ({
    value: form[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setForm((f) => ({ ...f, [key]: value }));
    },
  });
}

/** A labelled input. Browser autofill is off: nothing in these dialogs is the viewer's own. */
function Field({
  id,
  label,
  ...input
}: { id: string; label: ReactNode } & ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} autoComplete="off" {...input} />
    </div>
  );
}

function ConnectFooter({
  pending,
  onCancel,
  children,
}: {
  pending: boolean;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <DialogFooter>
      {children}
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={pending}>
        <RollInText text={pending ? "Connecting…" : "Connect"} />
      </Button>
    </DialogFooter>
  );
}

export function AiSettingsClient({
  connections,
  canManage,
  canEnablePersonalSubscriptions,
  personalSubscriptionsAllowed,
  localSubscriptionTestEnabled = false,
  localSubscriptionStatuses = [],
  connectorScope,
}: {
  connections: ProviderConnection[];
  canManage: boolean;
  canEnablePersonalSubscriptions: boolean;
  personalSubscriptionsAllowed: boolean;
  localSubscriptionTestEnabled?: boolean;
  localSubscriptionStatuses?: LocalSubscriptionStatus[];
  connectorScope: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<ConnectDialog | null>(null);
  const dialogProps = (name: ConnectDialog) => ({
    open: dialog === name,
    onOpenChange: (open: boolean) => setDialog(open ? name : null),
  });
  const closeDialog = () => setDialog(null);
  const [provider, setProvider] = useState<ApiKeyProvider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [keyName, setKeyName] = useState("");
  const [vertex, setVertex] = useState(EMPTY_VERTEX);
  const [anthropic, setAnthropic] = useState(EMPTY_ANTHROPIC);
  const [azure, setAzure] = useState(EMPTY_AZURE);
  const [compat, setCompat] = useState(EMPTY_COMPAT);
  const vertexField = bindField(vertex, setVertex);
  const anthropicField = bindField(anthropic, setAnthropic);
  const azureField = bindField(azure, setAzure);
  const compatField = bindField(compat, setCompat);
  const [compatTestResult, setCompatTestResult] =
    useState<OpenAiCompatibleTestResult | null>(null);
  const [isTestingCompat, startCompatTest] = useTransition();
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const [personalSubscriptionsOn, setPersonalSubscriptionsOn] = useState(
    personalSubscriptionsAllowed
  );

  function togglePersonalSubscriptions(next: boolean) {
    setPersonalSubscriptionsOn(next);
    startTransition(async () => {
      try {
        await updatePersonalAiSubscriptionsAllowedAction(next);
        toast.success(next ? "Personal AI subscriptions enabled" : "Personal AI subscriptions disabled");
      } catch {
        setPersonalSubscriptionsOn(!next);
        toast.error("Could not update personal AI subscriptions");
      }
    });
  }

  const byokConnections = connections.filter(
    (c) => c.type === "api_key" && c.provider !== "openai_compatible"
  );
  const openAiCompatibleConnections = connections.filter(
    (c) => c.provider === "openai_compatible"
  );
  const federatedConnections = connections.filter((c) => c.type === "federated");
  const legacySubscriptions = connections.filter((c) => c.type === "subscription");

  useEffect(() => {
    if (!localSubscriptionTestEnabled) return;

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "local-subscription:connected") return;
      toast.success("Subscription connected through the local provider CLI");
      router.refresh();
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router, localSubscriptionTestEnabled]);

  function openSubscriptionPopup(provider: LocalSubscriptionProvider) {
    const popup = window.open(
      `/subscription-connect/${provider}`,
      "ciele-local-subscription",
      "popup,width=480,height=620"
    );
    if (!popup) {
      toast.error("Allow popups to connect the provider subscription.");
    }
  }

  function handleLocalSubscriptionDisconnect(
    provider: LocalSubscriptionProvider,
    label: string
  ) {
    confirmDelete({
      title: `Disconnect ${label}?`,
      description: "This signs the provider CLI out on this machine.",
      confirmLabel: "Disconnect",
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/local-subscriptions/${provider}`, {
            method: "DELETE",
          });
          const body = (await response.json()) as { error?: string };
          if (!response.ok) throw new Error(body.error || "Disconnect failed.");
          toast.success(`${label} disconnected`);
          router.refresh();
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : `Couldn't disconnect ${label}`
          );
        }
      },
    });
  }

  /** Runs one connect action: its error, or success + reset + close. */
  function submitConnect(
    e: React.FormEvent,
    run: () => Promise<{ error?: string } | undefined>,
    success: string,
    failure: string,
    reset: () => void,
  ) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const result = await run();
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        toast.success(success);
        reset();
        closeDialog();
      } catch {
        toast.error(failure);
      }
    });
  }

  function handleAddKey(e: React.FormEvent) {
    if (!apiKey.trim()) {
      e.preventDefault();
      return;
    }
    submitConnect(
      e,
      () =>
        createProviderConnectionAction(
          provider,
          apiKey,
          keyName.trim() || CONNECTION_PROVIDER_LABELS[provider]
        ),
      "API key connected",
      "Couldn't connect the API key",
      () => {
        setApiKey("");
        setKeyName("");
      }
    );
  }

  function handleTestCompat() {
    setCompatTestResult(null);
    startCompatTest(async () => {
      try {
        const result = await testOpenAiCompatibleConnectionAction({
          baseUrl: compat.baseUrl,
          apiKey: compat.apiKey || undefined,
          chatModel: compat.chatModel,
          embeddingModel: compat.embeddingModel || undefined,
        });
        setCompatTestResult(result);
      } catch {
        toast.error("Couldn't run the connection test");
      }
    });
  }

  // Disconnecting deletes the stored credential: whatever ran on it stops
  // until someone pastes the key again, so it asks first like the local
  // subscription disconnect above.
  function handleDisconnect(id: string, what: string) {
    confirmDelete({
      title: `Disconnect this ${what.toLowerCase()}?`,
      description:
        "The stored credential is deleted. Anything that runs on it stops until it is connected again.",
      confirmLabel: "Disconnect",
      onConfirm: () =>
        startTransition(async () => {
          try {
            await deleteProviderConnectionAction(id);
            toast.success(`${what} disconnected`);
          } catch {
            toast.error(`Couldn't disconnect the ${what.toLowerCase()}`);
          }
        }),
    });
  }

  return (
    <div className="mt-8 space-y-8">
      <Card size="sm" data-animate-group className="gap-0 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AnimatedIcon icon={Key} size={16} iconClassName="text-primary" />
            <h2 className="text-base font-semibold">API keys</h2>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setDialog("key")}>
              <AnimatedIcon icon={Plus} size={16} /> Connect
            </Button>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Use your own provider key and billing. Keys are stored encrypted. An AI
          Gateway key serves Anthropic, OpenAI, and Google models through your own
          Vercel AI Gateway account.
        </p>
        <div className="mt-3 space-y-2">
          {byokConnections.length === 0 && (
            <p className="text-muted-foreground text-sm">No keys connected.</p>
          )}
          {byokConnections.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-xl border px-4 py-2.5"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {c.displayName || CONNECTION_PROVIDER_LABELS[c.provider]}
                {c.keyHint && (
                  <span className="text-muted-foreground ml-2 font-mono text-xs">
                    {c.keyHint}
                  </span>
                )}
              </span>
              <Badge variant="outline" className="rounded-full">
                {CONNECTION_PROVIDER_LABELS[c.provider]}
              </Badge>
              {canManage && (
                <Hint label="Disconnect">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Disconnect ${c.displayName || CONNECTION_PROVIDER_LABELS[c.provider]}`}
                    disabled={isPending}
                    onClick={() => handleDisconnect(c.id, "Key")}
                  >
                    <AnimatedIcon icon={Trash2} size={16} />
                  </Button>
                </Hint>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card size="sm" data-animate-group className="gap-0 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AnimatedIcon icon={Server} size={16} iconClassName="text-primary" />
            <h2 className="text-base font-semibold">OpenAI-compatible endpoints</h2>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setDialog("compat")}>
              <AnimatedIcon icon={Plus} size={16} /> Connect
            </Button>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Any OpenAI-compatible server, like Ollama, vLLM or LM Studio. The API key is optional.
        </p>
        <div className="mt-3 space-y-2">
          {openAiCompatibleConnections.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No endpoints connected.
            </p>
          )}
          {openAiCompatibleConnections.map((c) => {
            const compat = isOpenAiCompatibleConfig(c.config) ? c.config : null;
            return (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-xl border px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {c.displayName || CONNECTION_PROVIDER_LABELS[c.provider]}
                    {c.keyHint && (
                      <span className="text-muted-foreground ml-2 font-mono text-xs">
                        {c.keyHint}
                      </span>
                    )}
                  </p>
                  {compat && (
                    <p className="text-muted-foreground truncate text-xs">
                      {compat.baseUrl} - {compat.chatModel}
                      {compat.embeddingModel
                        ? ` - ${compat.embeddingModel}`
                        : ""}
                    </p>
                  )}
                </div>
                <Badge variant="outline" className="rounded-full">
                  OpenAI-compatible
                </Badge>
                {canManage && (
                  <Hint label="Disconnect">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Disconnect ${c.displayName || CONNECTION_PROVIDER_LABELS[c.provider]}`}
                      disabled={isPending}
                      onClick={() => handleDisconnect(c.id, "Endpoint")}
                    >
                      <AnimatedIcon icon={Trash2} size={16} />
                    </Button>
                  </Hint>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card size="sm" data-animate-group className="gap-0 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AnimatedIcon icon={CloudCog} size={16} iconClassName="text-primary" />
            <h2 className="text-base font-semibold">Keyless enterprise auth</h2>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setDialog("vertex")}>
                <AnimatedIcon icon={Plus} size={16} /> Google Vertex
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialog("anthropic")}
              >
                <AnimatedIcon icon={Plus} size={16} /> Anthropic WIF
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialog("azure")}
              >
                <AnimatedIcon icon={Plus} size={16} /> Azure OpenAI
              </Button>
            </div>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Keyless access to enterprise cloud APIs, billed to your cloud account. Not for personal subscriptions.
        </p>
        <div className="mt-3 space-y-2">
          {federatedConnections.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No keyless provider connections configured.
            </p>
          )}
          {federatedConnections.map((c) => {
            const googleVertex = isGoogleVertexConfig(c.config)
              ? c.config
              : null;
            const anthropicWif = isAnthropicWifConfig(c.config)
              ? c.config
              : null;
            const azureOpenAi = isAzureOpenAiConfig(c.config)
              ? c.config
              : null;
            return (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-xl border px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {c.displayName || CONNECTION_PROVIDER_LABELS[c.provider]}
                  </p>
                  {googleVertex && (
                    <p className="text-muted-foreground truncate text-xs">
                      {googleVertex.projectId} - {googleVertex.location}
                      {googleVertex.serviceAccountEmail
                        ? ` - ${googleVertex.serviceAccountEmail}`
                        : ""}
                    </p>
                  )}
                  {anthropicWif && (
                    <p className="text-muted-foreground truncate text-xs">
                      {anthropicWif.organizationId || "Anthropic org"} -
                      {anthropicWif.workspaceId || " all workspaces"}
                    </p>
                  )}
                  {azureOpenAi && (
                    <p className="text-muted-foreground truncate text-xs">
                      {azureOpenAi.endpoint} - {azureOpenAi.deployment}
                    </p>
                  )}
                </div>
                <Badge variant="outline" className="rounded-full">
                  {googleVertex
                    ? "Google Vertex"
                    : anthropicWif
                      ? "Anthropic WIF"
                      : azureOpenAi
                        ? "Azure OpenAI"
                    : CONNECTION_PROVIDER_LABELS[c.provider]}
                </Badge>
                {canManage && (
                  <Hint label="Disconnect keyless auth">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Disconnect ${c.displayName || CONNECTION_PROVIDER_LABELS[c.provider]}`}
                      disabled={isPending}
                      onClick={() => handleDisconnect(c.id, "Keyless auth")}
                    >
                      <AnimatedIcon icon={Trash2} size={16} />
                    </Button>
                  </Hint>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card size="sm" data-animate-group className="gap-0 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <AnimatedIcon icon={User} size={16} iconClassName="text-primary" />
              <h2 className="text-base font-semibold">Personal AI subscriptions</h2>
            </div>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Let Members use their own ChatGPT or Claude subscription in their Preview. It never serves visitors or other Members.
            </p>
            {!canEnablePersonalSubscriptions && !personalSubscriptionsOn && (
              <p className="text-muted-foreground mt-2 text-xs">
                An Organization owner must enable this capability.
              </p>
            )}
          </div>
          <Switch
            checked={personalSubscriptionsOn}
            onCheckedChange={togglePersonalSubscriptions}
            disabled={!canEnablePersonalSubscriptions || isPending}
            aria-label="Allow personal AI subscriptions"
          />
        </div>
      </Card>

      {personalSubscriptionsOn && (
        <LocalConnectorSettings
          connectorScope={connectorScope}
          localTest={
            localSubscriptionTestEnabled
              ? {
                  statuses: localSubscriptionStatuses,
                  busy: isPending,
                  onConnect: openSubscriptionPopup,
                  onDisconnect: handleLocalSubscriptionDisconnect,
                }
              : undefined
          }
        />
      )}

      {legacySubscriptions.length > 0 && (
        <Card size="sm" className="gap-0 bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Retired subscriptions</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Ciele no longer uses hosted Claude or ChatGPT subscription tokens. Use an API key instead.
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {legacySubscriptions.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-xl border bg-background px-4 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {c.displayName || CONNECTION_PROVIDER_LABELS[c.provider]}
                  {c.keyHint && (
                    <span className="text-muted-foreground ml-2 font-mono text-xs">
                      {c.keyHint}
                    </span>
                  )}
                </span>
                <StatusPill status="offline" primaryText="Retired" />
                {canManage && (
                  <Hint label="Remove retired subscription">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${c.displayName || CONNECTION_PROVIDER_LABELS[c.provider]}`}
                      disabled={isPending}
                      onClick={() => handleDisconnect(c.id, "Retired subscription")}
                    >
                      <AnimatedIcon icon={Trash2} size={16} />
                    </Button>
                  </Hint>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Dialog {...dialogProps("key")}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect an API key</DialogTitle>
            <DialogDescription>
              The key is checked with the provider, encrypted at rest, and never
              sent to the browser.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddKey} className="space-y-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={(value) => setProvider(value as ApiKeyProvider)}>
                <SelectTrigger aria-label="Provider" className="w-full">
                  <SelectValue>{CONNECTION_PROVIDER_LABELS[provider]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {BYOK_PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {CONNECTION_PROVIDER_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field
              id="api-key"
              label="API key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              required
            />
            <Field
              id="key-name"
              label="Display name (optional)"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="e.g. Production billing key"
            />
            <ConnectFooter pending={isPending} onCancel={closeDialog} />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog {...dialogProps("vertex")}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect Google Vertex</DialogTitle>
            <DialogDescription>
              Store the non-secret Workload Identity Federation settings Ciele
              needs to mint short-lived Vertex credentials at runtime.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) =>
              submitConnect(
                e,
                () => createGoogleVertexFederatedConnectionAction(vertex),
                "Google Vertex keyless auth connected",
                "Couldn't connect Google Vertex keyless auth",
                () => setVertex(EMPTY_VERTEX)
              )
            }
            className="space-y-4"
          >
            <Field
              id="vertex-name"
              label="Display name (optional)"
              {...vertexField("displayName")}
              placeholder="e.g. Production Vertex"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="vertex-project"
                label="Project ID"
                spellCheck={false}
                {...vertexField("projectId")}
                placeholder="ciele-prod"
                required
              />
              <Field
                id="vertex-location"
                label="Location"
                spellCheck={false}
                {...vertexField("location")}
                placeholder="europe-west4"
                required
              />
            </div>
            <Field
              id="vertex-audience"
              label="WIF audience"
              spellCheck={false}
              {...vertexField("workloadIdentityAudience")}
              placeholder="//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/ciele/providers/vercel"
              required
            />
            <Field
              id="vertex-service-account"
              label="Service account email (optional)"
              type="email"
              inputMode="email"
              spellCheck={false}
              {...vertexField("serviceAccountEmail")}
              placeholder="ciele-runtime@ciele-prod.iam.gserviceaccount.com"
            />
            <ConnectFooter pending={isPending} onCancel={closeDialog} />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog {...dialogProps("anthropic")}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect Anthropic WIF</DialogTitle>
            <DialogDescription>
              Workload Identity Federation settings for Anthropic API billing.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) =>
              submitConnect(
                e,
                () => createAnthropicWifFederatedConnectionAction(anthropic),
                "Anthropic WIF connected",
                "Couldn't connect Anthropic WIF",
                () => setAnthropic(EMPTY_ANTHROPIC)
              )
            }
            className="space-y-4"
          >
            <Field
              id="anthropic-name"
              label="Display name (optional)"
              {...anthropicField("displayName")}
              placeholder="e.g. Anthropic enterprise WIF"
            />
            <Field
              id="anthropic-audience"
              label="WIF audience"
              spellCheck={false}
              {...anthropicField("workloadIdentityAudience")}
              placeholder="trusted identity provider audience"
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="anthropic-org"
                label="Organization ID (optional)"
                spellCheck={false}
                {...anthropicField("organizationId")}
                placeholder="org_..."
              />
              <Field
                id="anthropic-workspace"
                label="Workspace ID (optional)"
                spellCheck={false}
                {...anthropicField("workspaceId")}
                placeholder="wrkspc_..."
              />
            </div>
            <ConnectFooter pending={isPending} onCancel={closeDialog} />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog {...dialogProps("azure")}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect Azure OpenAI</DialogTitle>
            <DialogDescription>
              Store non-secret Entra and deployment settings for tenant-billed
              Azure OpenAI. This is separate from direct OpenAI API keys.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) =>
              submitConnect(
                e,
                () => createAzureOpenAiFederatedConnectionAction(azure),
                "Azure OpenAI keyless auth connected",
                "Couldn't connect Azure OpenAI keyless auth",
                () => setAzure(EMPTY_AZURE)
              )
            }
            className="space-y-4"
          >
            <Field
              id="azure-name"
              label="Display name (optional)"
              {...azureField("displayName")}
              placeholder="e.g. Enterprise Azure OpenAI"
            />
            <Field
              id="azure-endpoint"
              label="Endpoint"
              type="url"
              inputMode="url"
              spellCheck={false}
              {...azureField("endpoint")}
              placeholder="https://example.openai.azure.com"
              required
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="azure-tenant"
                label="Tenant ID"
                spellCheck={false}
                {...azureField("tenantId")}
                placeholder="00000000-0000-0000-0000-000000000000"
                required
              />
              <Field
                id="azure-deployment"
                label="Deployment"
                spellCheck={false}
                {...azureField("deployment")}
                placeholder="gpt-4.1"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="azure-client"
                label="Client ID (optional)"
                spellCheck={false}
                {...azureField("clientId")}
                placeholder="managed identity client id"
              />
              <Field
                id="azure-audience"
                label="Audience (optional)"
                spellCheck={false}
                {...azureField("audience")}
                placeholder="https://cognitiveservices.azure.com/.default"
              />
            </div>
            <ConnectFooter pending={isPending} onCancel={closeDialog} />
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialog === "compat"}
        onOpenChange={(open) => {
          setDialog(open ? "compat" : null);
          if (!open) setCompatTestResult(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect an OpenAI-compatible endpoint</DialogTitle>
            <DialogDescription>
              Any OpenAI-compatible server. The key is optional and stored encrypted.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) =>
              submitConnect(
                e,
                () =>
                  createOpenAiCompatibleConnectionAction({
                    ...compat,
                    apiKey: compat.apiKey || undefined,
                    embeddingModel: compat.embeddingModel || undefined,
                  }),
                "OpenAI-compatible endpoint connected",
                "Couldn't connect the endpoint",
                () => {
                  setCompat(EMPTY_COMPAT);
                  setCompatTestResult(null);
                }
              )
            }
            className="space-y-4"
          >
            <Field
              id="compat-name"
              label="Display name (optional)"
              {...compatField("displayName")}
              placeholder="e.g. Campus Ollama"
            />
            <Field
              id="compat-base-url"
              label="Base URL"
              type="url"
              inputMode="url"
              spellCheck={false}
              {...compatField("baseUrl")}
              placeholder="http://localhost:11434/v1"
              required
            />
            <Field
              id="compat-api-key"
              label="API key (optional)"
              type="password"
              {...compatField("apiKey")}
              placeholder="Leave empty for local servers"
            />
            <Field
              id="compat-chat-model"
              label="Chat model"
              spellCheck={false}
              {...compatField("chatModel")}
              placeholder="llama3.1:8b"
              required
            />
            <Field
              id="compat-embedding-model"
              label="Embedding model (optional)"
              spellCheck={false}
              {...compatField("embeddingModel")}
              placeholder="nomic-embed-text"
            />
            {/* Always mounted, so the result is announced when it arrives. */}
            <div role="status" aria-live="polite">
            {compatTestResult && (
              <div className="space-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                {compatTestResult.chat.ok ? (
                  <p className="text-emerald-600 dark:text-emerald-400">
                    Chat: ✓ model responded
                  </p>
                ) : (
                  <p className="text-destructive">
                    Chat: ✗ {compatTestResult.chat.detail || "request failed"}
                  </p>
                )}
                {compatTestResult.embedding === null ? (
                  <p className="text-muted-foreground">
                    Embeddings: not configured, knowledge search stays lexical
                  </p>
                ) : compatTestResult.embedding.ok ? (
                  <p className="text-emerald-600 dark:text-emerald-400">
                    Embeddings: ✓
                    {compatTestResult.embedding.dims !== null
                      ? ` ${compatTestResult.embedding.dims} dimensions`
                      : " model responded"}
                  </p>
                ) : (
                  <p className="text-destructive">
                    Embeddings: ✗{" "}
                    {compatTestResult.embedding.detail || "request failed"}
                  </p>
                )}
              </div>
            )}
            </div>
            <ConnectFooter pending={isPending} onCancel={closeDialog}>
              <Button
                type="button"
                variant="outline"
                disabled={
                  isTestingCompat ||
                  !compat.baseUrl.trim() ||
                  !compat.chatModel.trim()
                }
                onClick={handleTestCompat}
              >
                <RollInText text={isTestingCompat ? "Testing…" : "Test connection"} />
              </Button>
            </ConnectFooter>
          </form>
        </DialogContent>
      </Dialog>

      {confirmDeleteModal}
    </div>
  );
}
