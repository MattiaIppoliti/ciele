"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  AnthropicWifFederatedConfig,
  AzureOpenAiFederatedConfig,
  GoogleVertexFederatedConfig,
  OpenAiCompatibleConfig,
  Provider,
  ProviderConnection,
  ProviderConnectionProvider,
} from "@agent-hub/db";
import { CloudCog, Key, Plus, Server, Trash2, User } from "lucide-react";
import { toast } from "sonner";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import { LocalConnectorSettings } from "@/components/settings/local-connector-settings";
import type {
  LocalSubscriptionProvider,
  LocalSubscriptionStatus,
} from "@/lib/local-subscriptions";
import { Switch } from "@/components/ui/switch";

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI (GPT)",
  google: "Google (Gemini)",
  openai_compatible: "OpenAI-compatible (Ollama, vLLM, …)",
};

/** Providers the generic hosted-API-key dialog can connect. OpenAI-compatible
 *  endpoints have their own form (base URL + models, key optional). */
const BYOK_PROVIDERS: Provider[] = ["anthropic", "openai", "google"];

type OpenAiCompatibleTestResult = Awaited<
  ReturnType<typeof testOpenAiCompatibleConnectionAction>
>;

const CONNECTION_PROVIDER_LABELS: Record<ProviderConnectionProvider, string> = {
  ...PROVIDER_LABELS,
  azure_openai: "Azure OpenAI",
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
  availability: Record<
    Provider,
    { platform: boolean; byok: boolean; federated: boolean }
  >;
  canManage: boolean;
  canEnablePersonalSubscriptions: boolean;
  personalSubscriptionsAllowed: boolean;
  localSubscriptionTestEnabled?: boolean;
  localSubscriptionStatuses?: LocalSubscriptionStatus[];
  connectorScope: string;
}) {
  const router = useRouter();
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [keyName, setKeyName] = useState("");
  const [vertexDialogOpen, setVertexDialogOpen] = useState(false);
  const [vertexDisplayName, setVertexDisplayName] = useState("");
  const [vertexProjectId, setVertexProjectId] = useState("");
  const [vertexLocation, setVertexLocation] = useState("europe-west4");
  const [vertexAudience, setVertexAudience] = useState("");
  const [vertexServiceAccount, setVertexServiceAccount] = useState("");
  const [anthropicDialogOpen, setAnthropicDialogOpen] = useState(false);
  const [anthropicDisplayName, setAnthropicDisplayName] = useState("");
  const [anthropicAudience, setAnthropicAudience] = useState("");
  const [anthropicOrgId, setAnthropicOrgId] = useState("");
  const [anthropicWorkspaceId, setAnthropicWorkspaceId] = useState("");
  const [azureDialogOpen, setAzureDialogOpen] = useState(false);
  const [azureDisplayName, setAzureDisplayName] = useState("");
  const [azureTenantId, setAzureTenantId] = useState("");
  const [azureEndpoint, setAzureEndpoint] = useState("");
  const [azureDeployment, setAzureDeployment] = useState("");
  const [azureClientId, setAzureClientId] = useState("");
  const [azureAudience, setAzureAudience] = useState("");
  const [compatDialogOpen, setCompatDialogOpen] = useState(false);
  const [compatDisplayName, setCompatDisplayName] = useState("");
  const [compatBaseUrl, setCompatBaseUrl] = useState("");
  const [compatApiKey, setCompatApiKey] = useState("");
  const [compatChatModel, setCompatChatModel] = useState("");
  const [compatEmbeddingModel, setCompatEmbeddingModel] = useState("");
  const [compatEmbeddingDims, setCompatEmbeddingDims] = useState("");
  const [compatTestResult, setCompatTestResult] =
    useState<OpenAiCompatibleTestResult | null>(null);
  const [isTestingCompat, startCompatTest] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [personalSubscriptionsOn, setPersonalSubscriptionsOn] = useState(
    personalSubscriptionsAllowed
  );

  function togglePersonalSubscriptions(next: boolean) {
    setPersonalSubscriptionsOn(next);
    startTransition(async () => {
      try {
        await updatePersonalAiSubscriptionsAllowedAction(next);
        toast.success(next ? "Personal AI subscriptions enabled" : "Personal AI subscriptions disabled");
        router.refresh();
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
    if (
      !window.confirm(
        `Disconnect ${label}? This signs the provider CLI out on this machine.`
      )
    ) {
      return;
    }
    startTransition(async () => {
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
          error instanceof Error ? error.message : `Couldn't disconnect ${label}`
        );
      }
    });
  }

  function handleAddKey(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    startTransition(async () => {
      try {
        const result = await createProviderConnectionAction(
          provider,
          apiKey,
          keyName.trim() || PROVIDER_LABELS[provider]
        );
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        toast.success("API key connected");
        setApiKey("");
        setKeyName("");
        setKeyDialogOpen(false);
      } catch {
        toast.error("Couldn't connect the API key");
      }
    });
  }

  function handleAddGoogleVertex(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const result = await createGoogleVertexFederatedConnectionAction({
          displayName: vertexDisplayName,
          projectId: vertexProjectId,
          location: vertexLocation,
          workloadIdentityAudience: vertexAudience,
          serviceAccountEmail: vertexServiceAccount,
        });
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Google Vertex keyless auth connected");
        setVertexDisplayName("");
        setVertexProjectId("");
        setVertexLocation("europe-west4");
        setVertexAudience("");
        setVertexServiceAccount("");
        setVertexDialogOpen(false);
      } catch {
        toast.error("Couldn't connect Google Vertex keyless auth");
      }
    });
  }

  function handleAddAnthropicWif(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const result = await createAnthropicWifFederatedConnectionAction({
          displayName: anthropicDisplayName,
          workloadIdentityAudience: anthropicAudience,
          organizationId: anthropicOrgId,
          workspaceId: anthropicWorkspaceId,
        });
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Anthropic WIF connected");
        setAnthropicDisplayName("");
        setAnthropicAudience("");
        setAnthropicOrgId("");
        setAnthropicWorkspaceId("");
        setAnthropicDialogOpen(false);
      } catch {
        toast.error("Couldn't connect Anthropic WIF");
      }
    });
  }

  function handleAddAzureOpenAi(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const result = await createAzureOpenAiFederatedConnectionAction({
          displayName: azureDisplayName,
          tenantId: azureTenantId,
          endpoint: azureEndpoint,
          deployment: azureDeployment,
          clientId: azureClientId,
          audience: azureAudience,
        });
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        toast.success("Azure OpenAI keyless auth connected");
        setAzureDisplayName("");
        setAzureTenantId("");
        setAzureEndpoint("");
        setAzureDeployment("");
        setAzureClientId("");
        setAzureAudience("");
        setAzureDialogOpen(false);
      } catch {
        toast.error("Couldn't connect Azure OpenAI keyless auth");
      }
    });
  }

  function resetCompatForm() {
    setCompatDisplayName("");
    setCompatBaseUrl("");
    setCompatApiKey("");
    setCompatChatModel("");
    setCompatEmbeddingModel("");
    setCompatEmbeddingDims("");
    setCompatTestResult(null);
  }

  function handleTestCompat() {
    setCompatTestResult(null);
    startCompatTest(async () => {
      try {
        const result = await testOpenAiCompatibleConnectionAction({
          baseUrl: compatBaseUrl,
          apiKey: compatApiKey || undefined,
          chatModel: compatChatModel,
          embeddingModel: compatEmbeddingModel || undefined,
        });
        setCompatTestResult(result);
      } catch {
        toast.error("Couldn't run the connection test");
      }
    });
  }

  function handleAddOpenAiCompatible(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const dims = compatEmbeddingDims.trim();
        const result = await createOpenAiCompatibleConnectionAction({
          displayName: compatDisplayName,
          baseUrl: compatBaseUrl,
          apiKey: compatApiKey || undefined,
          chatModel: compatChatModel,
          embeddingModel: compatEmbeddingModel || undefined,
          embeddingDims: dims ? Number(dims) : undefined,
        });
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        toast.success("OpenAI-compatible endpoint connected");
        resetCompatForm();
        setCompatDialogOpen(false);
      } catch {
        toast.error("Couldn't connect the endpoint");
      }
    });
  }

  function handleDisconnect(id: string, what: string) {
    startTransition(async () => {
      try {
        await deleteProviderConnectionAction(id);
        toast.success(`${what} disconnected`);
      } catch {
        toast.error(`Couldn't disconnect the ${what.toLowerCase()}`);
      }
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
            <Button size="sm" onClick={() => setKeyDialogOpen(true)}>
              <AnimatedIcon icon={Plus} size={16} /> Connect
            </Button>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Bring your own provider API key. Your assistants run on your billing.
          Keys are stored encrypted and used only server-side.
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
                    aria-label="Disconnect"
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
            <Button size="sm" onClick={() => setCompatDialogOpen(true)}>
              <AnimatedIcon icon={Plus} size={16} /> Connect
            </Button>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Point Ciele at any server speaking the OpenAI chat/embeddings API —
          Ollama, vLLM, LM Studio, or a gateway. Works with or without an API
          key, including fully local models.
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
                        ? ` - ${compat.embeddingModel}${
                            compat.embeddingDims
                              ? ` (${compat.embeddingDims}d)`
                              : ""
                          }`
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
                      aria-label="Disconnect"
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
              <Button size="sm" onClick={() => setVertexDialogOpen(true)}>
                <AnimatedIcon icon={Plus} size={16} /> Google Vertex
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAnthropicDialogOpen(true)}
              >
                <AnimatedIcon icon={Plus} size={16} /> Anthropic WIF
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAzureDialogOpen(true)}
              >
                <AnimatedIcon icon={Plus} size={16} /> Azure OpenAI
              </Button>
            </div>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect tenant-billed cloud identity federation for enterprise APIs.
          This is not Claude Pro/Max or ChatGPT Plus/Pro subscription reuse;
          API keys remain available above.
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
                      aria-label="Disconnect keyless auth"
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
              Allow Members to connect their own ChatGPT or Claude subscription
              for Preview sessions on their device. Personal subscriptions never
              serve published widgets or other Members.
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

      {personalSubscriptionsOn && !localSubscriptionTestEnabled && (
        <LocalConnectorSettings
          connectorScope={connectorScope}
        />
      )}

      {personalSubscriptionsOn && localSubscriptionTestEnabled && (
        <Card size="sm" data-animate-group className="gap-0 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <AnimatedIcon icon={User} size={16} iconClassName="text-primary" />
                <h2 className="text-base font-semibold">AI subscriptions</h2>
                <Badge
                  variant="outline"
                  className="rounded-full border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                >
                  Local test
                </Badge>
              </div>
              <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
                Connect a real ChatGPT or Claude subscription through the
                official Codex or Claude Code CLI installed on this machine.
                Credentials stay in the provider CLI&apos;s local credential store.
              </p>
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button size="sm" />}
                >
                  <AnimatedIcon icon={Plus} size={16} /> Connect
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>Subscription</DropdownMenuLabel>
                  {localSubscriptionStatuses.map((status) => (
                    <DropdownMenuItem
                      key={status.provider}
                      className="items-start py-2"
                      disabled={status.connected}
                      onClick={() => openSubscriptionPopup(status.provider)}
                    >
                      <div>
                        <p>{status.label}</p>
                        <p className="text-muted-foreground text-xs">
                          {status.detail}
                        </p>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
          </div>

          <div className="mt-3 space-y-2">
            {localSubscriptionStatuses.map((status) => (
              <div
                key={status.provider}
                className="flex items-center gap-3 rounded-xl border px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{status.label}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {status.connected
                      ? [status.accountLabel, status.plan].filter(Boolean).join(" · ") ||
                        "Authenticated through the provider CLI"
                      : status.available
                        ? status.error || "Not connected"
                        : status.error || "Provider CLI unavailable"}
                  </p>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {status.connected
                    ? "Connected"
                    : status.connecting
                      ? "Connecting"
                      : "Not connected"}
                </Badge>
                {status.connected && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Disconnect ${status.label}`}
                    disabled={isPending}
                    onClick={() =>
                      handleLocalSubscriptionDisconnect(status.provider, status.label)
                    }
                  >
                    <AnimatedIcon icon={Trash2} size={16} />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {legacySubscriptions.length > 0 && (
        <Card size="sm" className="gap-0 bg-muted/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Retired subscriptions</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Hosted Claude and ChatGPT subscription tokens are no longer used
                by Ciele. API keys remain supported; keyless enterprise auth is
                configured separately.
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
                <Badge variant="outline" className="rounded-full">
                  Retired
                </Badge>
                {canManage && (
                  <Hint label="Remove retired subscription">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove retired subscription"
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

      <Dialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
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
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start"
                    />
                  }
                >
                  {PROVIDER_LABELS[provider]}
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72">
                  {BYOK_PROVIDERS.map((p) => (
                    <DropdownMenuItem key={p} onClick={() => setProvider(p)}>
                      {PROVIDER_LABELS[p]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key">API key</Label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-name">Display name (optional)</Label>
              <Input
                id="key-name"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="e.g. Production billing key"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setKeyDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Connecting..." : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={vertexDialogOpen} onOpenChange={setVertexDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect Google Vertex</DialogTitle>
            <DialogDescription>
              Store the non-secret Workload Identity Federation settings Ciele
              needs to mint short-lived Vertex credentials at runtime.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddGoogleVertex} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vertex-name">Display name (optional)</Label>
              <Input
                id="vertex-name"
                value={vertexDisplayName}
                onChange={(e) => setVertexDisplayName(e.target.value)}
                placeholder="e.g. Production Vertex"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vertex-project">Project ID</Label>
                <Input
                  id="vertex-project"
                  value={vertexProjectId}
                  onChange={(e) => setVertexProjectId(e.target.value)}
                  placeholder="ciele-prod"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vertex-location">Location</Label>
                <Input
                  id="vertex-location"
                  value={vertexLocation}
                  onChange={(e) => setVertexLocation(e.target.value)}
                  placeholder="europe-west4"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vertex-audience">WIF audience</Label>
              <Input
                id="vertex-audience"
                value={vertexAudience}
                onChange={(e) => setVertexAudience(e.target.value)}
                placeholder="//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/ciele/providers/vercel"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vertex-service-account">
                Service account email (optional)
              </Label>
              <Input
                id="vertex-service-account"
                value={vertexServiceAccount}
                onChange={(e) => setVertexServiceAccount(e.target.value)}
                placeholder="ciele-runtime@ciele-prod.iam.gserviceaccount.com"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setVertexDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Connecting..." : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={anthropicDialogOpen} onOpenChange={setAnthropicDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect Anthropic WIF</DialogTitle>
            <DialogDescription>
              Store non-secret Workload Identity Federation settings for
              Anthropic API billing. This does not use a Claude consumer plan.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddAnthropicWif} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="anthropic-name">Display name (optional)</Label>
              <Input
                id="anthropic-name"
                value={anthropicDisplayName}
                onChange={(e) => setAnthropicDisplayName(e.target.value)}
                placeholder="e.g. Anthropic enterprise WIF"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="anthropic-audience">WIF audience</Label>
              <Input
                id="anthropic-audience"
                value={anthropicAudience}
                onChange={(e) => setAnthropicAudience(e.target.value)}
                placeholder="trusted identity provider audience"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="anthropic-org">Organization ID (optional)</Label>
                <Input
                  id="anthropic-org"
                  value={anthropicOrgId}
                  onChange={(e) => setAnthropicOrgId(e.target.value)}
                  placeholder="org_..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="anthropic-workspace">
                  Workspace ID (optional)
                </Label>
                <Input
                  id="anthropic-workspace"
                  value={anthropicWorkspaceId}
                  onChange={(e) => setAnthropicWorkspaceId(e.target.value)}
                  placeholder="wrkspc_..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAnthropicDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Connecting..." : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={azureDialogOpen} onOpenChange={setAzureDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect Azure OpenAI</DialogTitle>
            <DialogDescription>
              Store non-secret Entra and deployment settings for tenant-billed
              Azure OpenAI. This is separate from direct OpenAI API keys.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddAzureOpenAi} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="azure-name">Display name (optional)</Label>
              <Input
                id="azure-name"
                value={azureDisplayName}
                onChange={(e) => setAzureDisplayName(e.target.value)}
                placeholder="e.g. Enterprise Azure OpenAI"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="azure-endpoint">Endpoint</Label>
              <Input
                id="azure-endpoint"
                value={azureEndpoint}
                onChange={(e) => setAzureEndpoint(e.target.value)}
                placeholder="https://example.openai.azure.com"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="azure-tenant">Tenant ID</Label>
                <Input
                  id="azure-tenant"
                  value={azureTenantId}
                  onChange={(e) => setAzureTenantId(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="azure-deployment">Deployment</Label>
                <Input
                  id="azure-deployment"
                  value={azureDeployment}
                  onChange={(e) => setAzureDeployment(e.target.value)}
                  placeholder="gpt-4.1"
                  required
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="azure-client">Client ID (optional)</Label>
                <Input
                  id="azure-client"
                  value={azureClientId}
                  onChange={(e) => setAzureClientId(e.target.value)}
                  placeholder="managed identity client id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="azure-audience">Audience (optional)</Label>
                <Input
                  id="azure-audience"
                  value={azureAudience}
                  onChange={(e) => setAzureAudience(e.target.value)}
                  placeholder="https://cognitiveservices.azure.com/.default"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAzureDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Connecting..." : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={compatDialogOpen}
        onOpenChange={(open) => {
          setCompatDialogOpen(open);
          if (!open) setCompatTestResult(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Connect an OpenAI-compatible endpoint</DialogTitle>
            <DialogDescription>
              Any server speaking the OpenAI chat/embeddings API: Ollama, vLLM,
              LM Studio, or a gateway. The key is optional and stored encrypted.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddOpenAiCompatible} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="compat-name">Display name (optional)</Label>
              <Input
                id="compat-name"
                value={compatDisplayName}
                onChange={(e) => setCompatDisplayName(e.target.value)}
                placeholder="e.g. Campus Ollama"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="compat-base-url">Base URL</Label>
              <Input
                id="compat-base-url"
                value={compatBaseUrl}
                onChange={(e) => setCompatBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="compat-api-key">API key (optional)</Label>
              <Input
                id="compat-api-key"
                type="password"
                value={compatApiKey}
                onChange={(e) => setCompatApiKey(e.target.value)}
                placeholder="Leave empty for local servers"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="compat-chat-model">Chat model</Label>
              <Input
                id="compat-chat-model"
                value={compatChatModel}
                onChange={(e) => setCompatChatModel(e.target.value)}
                placeholder="llama3.1:8b"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="compat-embedding-model">
                  Embedding model (optional)
                </Label>
                <Input
                  id="compat-embedding-model"
                  value={compatEmbeddingModel}
                  onChange={(e) => setCompatEmbeddingModel(e.target.value)}
                  placeholder="nomic-embed-text"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="compat-embedding-dims">
                  Embedding dimensions (optional)
                </Label>
                <Input
                  id="compat-embedding-dims"
                  type="number"
                  min={1}
                  step={1}
                  value={compatEmbeddingDims}
                  onChange={(e) => setCompatEmbeddingDims(e.target.value)}
                  placeholder="768"
                />
              </div>
            </div>
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
                    Embeddings: not configured — knowledge search stays lexical
                  </p>
                ) : compatTestResult.embedding.ok ? (
                  <p className="text-emerald-600 dark:text-emerald-400">
                    Embeddings: ✓
                    {compatTestResult.embedding.dims !== null
                      ? ` ${compatTestResult.embedding.dims} dimensions`
                      : " model responded"}
                    {compatTestResult.embedding.dims !== null &&
                      String(compatTestResult.embedding.dims) !==
                        compatEmbeddingDims.trim() && (
                        <button
                          type="button"
                          className="ml-2 underline underline-offset-2"
                          onClick={() =>
                            setCompatEmbeddingDims(
                              String(compatTestResult.embedding?.dims ?? "")
                            )
                          }
                        >
                          Fill dimensions field
                        </button>
                      )}
                  </p>
                ) : (
                  <p className="text-destructive">
                    Embeddings: ✗{" "}
                    {compatTestResult.embedding.detail || "request failed"}
                  </p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={
                  isTestingCompat ||
                  !compatBaseUrl.trim() ||
                  !compatChatModel.trim()
                }
                onClick={handleTestCompat}
              >
                {isTestingCompat ? "Testing..." : "Test connection"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCompatDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Connecting..." : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
