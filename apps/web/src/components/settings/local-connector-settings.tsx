"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Check,
  ChevronDown,
  LoaderCircle,
  MonitorDown,
  PlugZap,
  RotateCw,
} from "lucide-react";
import { toast } from "@/lib/toast";
import {
  Badge,
  Button,
  Card,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProviderBrandIcon } from "@/components/settings/provider-brand-icon";
import { LocalTerminalSetupGuide } from "@/components/settings/local-terminal-setup-guide";
import {
  buildModelOptionGroups,
  type ModelOptionGroup,
} from "@/lib/local-model-options";
import {
  CONNECTOR_BOOTSTRAP_PORT,
  CURRENT_CONNECTOR_VERSION,
  connectorBaseUrl,
  connectorNeedsUpgrade,
  parseConnectorPairing,
  previewAiPreferencesKey,
  sanitizeConnectorStatus,
  sanitizeConnectorPreferences,
  type ConnectorPairing,
  type ConnectorProvider,
  type ConnectorProviderStatus,
  type ConnectorStatus,
} from "@/lib/local-connector-protocol";
const PAIRING_STORAGE_KEY_PREFIX = "ciele.local-connector.pairing";

function pairingStorageKey(scope: string): string {
  return `${PAIRING_STORAGE_KEY_PREFIX}.${scope}`;
}

function storedPairing(scope: string): ConnectorPairing | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(pairingStorageKey(scope)) ?? "null"
    ) as { port?: unknown; token?: unknown; scope?: unknown } | null;
    if (!value) return null;
    const pairing = parseConnectorPairing(
      `#connectorPort=${String(value.port)}&connectorToken=${String(value.token)}&connectorScope=${String(value.scope)}`
    );
    return pairing?.scope === scope ? pairing : null;
  } catch {
    return null;
  }
}

function randomPairingToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function ModelPicker({
  value,
  groups,
  onChange,
}: {
  value: string;
  groups: ModelOptionGroup[];
  onChange: (value: string) => void;
}) {
  const options = groups.flatMap((group) => group.options);
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start sm:w-72"
          />
        }
      >
        {selected ? (
          <ProviderBrandIcon provider={selected.provider} className="size-4" />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-left">
          {selected?.label ?? "Automatic"}
        </span>
        <ChevronDown className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuItem onClick={() => onChange("automatic")}>
          <span className="flex-1">Automatic</span>
          {value === "automatic" && <Check className="size-4" />}
        </DropdownMenuItem>
        {groups.map((group) => (
          <div key={group.source}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.options.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => onChange(option.value)}
              >
                <ProviderBrandIcon provider={option.provider} className="size-4" />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {value === option.value && <Check className="size-4" />}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UsageIndicator({ provider }: { provider: ConnectorProviderStatus }) {
  const primary = provider.usage?.windows[0];
  const used = primary?.usedPercent ?? 0;
  const circumference = 2 * Math.PI * 8;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Show ${provider.label} usage`}
            className="text-muted-foreground hover:text-foreground rounded-full p-1 transition-colors"
          />
        }
      >
        <svg viewBox="0 0 20 20" className="size-7 -rotate-90" aria-hidden="true">
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2.5" opacity=".2" />
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - used / 100)}
          />
        </svg>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="text-sm font-medium">{provider.label} usage</p>
        {provider.tokenUsage && (
          <div className="bg-muted/60 mt-2 rounded-md px-2.5 py-2 text-xs">
            <p className="font-medium">Ciele Preview tokens</p>
            <p className="text-muted-foreground mt-0.5">
              {provider.tokenUsage.inputTokens.toLocaleString()} input ·{" "}
              {provider.tokenUsage.outputTokens.toLocaleString()} output
            </p>
            {provider.tokenUsage.updatedAt && (
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                Updated {new Date(provider.tokenUsage.updatedAt * 1_000).toLocaleString()}
              </p>
            )}
          </div>
        )}
        {provider.usage?.windows.length ? (
          <div className="mt-2 space-y-2">
            {provider.usage.windows.map((window) => (
              <div key={`${window.label}-${window.resetsAt ?? "unknown"}`}>
                <div className="flex items-center justify-between text-sm">
                  <span>{window.label}</span>
                  <span>{window.remainingPercent}% left</span>
                </div>
                <div className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full">
                  <div
                    className="bg-foreground h-full rounded-full"
                    style={{ width: `${window.usedPercent}%` }}
                  />
                </div>
                {window.resetsAt && (
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    Resets {new Date(window.resetsAt * 1_000).toLocaleString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground mt-2 text-xs">
            {provider.usageUnavailableReason ??
              "This CLI did not report a usage window."}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function LocalConnectorSettings({
  connectorScope,
}: {
  connectorScope: string;
}) {
  const [pairing, setPairing] = useState<ConnectorPairing | null>(null);
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busyProvider, setBusyProvider] = useState<ConnectorProvider | null>(null);
  const statusRequestGeneration = useRef(0);
  const relayPairingInFlight = useRef(false);
  const preferenceMutationGeneration = useRef(0);
  const pendingPreferenceWrites = useRef(0);
  const preferenceWriteChain = useRef(Promise.resolve());

  const connectorRequest = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!pairing) throw new Error("Ciele Connector is not paired.");
      const response = await fetch(`${connectorBaseUrl(pairing.port)}${path}`, {
        ...init,
        cache: "no-store",
        signal: init?.signal ?? AbortSignal.timeout(5_000),
        headers: {
          Authorization: `Bearer ${pairing.token}`,
          "X-Ciele-Connector-Scope": pairing.scope,
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "Connector request failed."
        );
      }
      return body;
    },
    [pairing]
  );

  const readStatus = useCallback(async (): Promise<ConnectorStatus | null> => {
    if (!pairing) return null;
    const body = await connectorRequest("/v1/status");
    return sanitizeConnectorStatus(body);
  }, [connectorRequest, pairing]);

  const refreshStatus = useCallback(async () => {
    if (pendingPreferenceWrites.current > 0) return;
    const generation = ++statusRequestGeneration.current;
    try {
      const nextStatus = await readStatus();
      if (generation === statusRequestGeneration.current) {
        if (nextStatus) setStatus(nextStatus);
        setChecking(false);
      }
    } catch {
      if (generation === statusRequestGeneration.current) setChecking(false);
    }
  }, [readStatus]);

  // The "Detecting" indicator must always terminate: if no poll settles it
  // (hung socket, connector that never answers), fall back to not-detected.
  useEffect(() => {
    if (!checking) return;
    const timer = window.setTimeout(() => setChecking(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [checking]);

  useEffect(() => {
    statusRequestGeneration.current += 1;
    const applyPairing = () => {
      setStatus(null);
      setChecking(true);
      const fragmentPairing = parseConnectorPairing(window.location.hash);
      const acceptedFragmentPairing =
        fragmentPairing?.scope === connectorScope ? fragmentPairing : null;
      const nextPairing = acceptedFragmentPairing ?? storedPairing(connectorScope);
      if (acceptedFragmentPairing) {
        localStorage.setItem(
          pairingStorageKey(connectorScope),
          JSON.stringify(acceptedFragmentPairing)
        );
        toast.success("Ciele Connector detected");
      } else if (fragmentPairing) {
        toast.error("This connector belongs to a different Ciele workspace.");
      }
      if (fragmentPairing) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`
        );
      }
      setPairing(nextPairing);
      if (!nextPairing) setChecking(false);
    };

    const timer = window.setTimeout(applyPairing, 0);
    window.addEventListener("hashchange", applyPairing);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", applyPairing);
    };
  }, [connectorScope]);

  // A generic signed desktop package cannot contain a Member or Organization secret.
  // Discover its fixed loopback bootstrap port, then bind it to this browser,
  // Member and Organization with a freshly generated local bearer secret.
  useEffect(() => {
    if (checking || pairing) return;
    let cancelled = false;
    let attempts = 0;
    let retryTimer: number | undefined;
    const bootstrap = async () => {
      attempts += 1;
      let completed = false;
      try {
        const baseUrl = connectorBaseUrl(CONNECTOR_BOOTSTRAP_PORT);
        const detected = await fetch(`${baseUrl}/v1/bootstrap-status`, {
          cache: "no-store",
          signal: AbortSignal.timeout(2_000),
        });
        if (!detected.ok) throw new Error("Connector is not ready.");
        const next: ConnectorPairing = {
          port: CONNECTOR_BOOTSTRAP_PORT,
          token: randomPairingToken(),
          scope: connectorScope,
        };
        const response = await fetch(`${baseUrl}/v1/bootstrap`, {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(2_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: next.token, scope: next.scope }),
        });
        if (!response.ok || cancelled) return;
        localStorage.setItem(pairingStorageKey(connectorScope), JSON.stringify(next));
        setPairing(next);
        setChecking(true);
        toast.success("Ciele Connector detected");
        completed = true;
      } catch {
        // No desktop package is installed; the install action remains visible.
      }
      if (!completed && !cancelled && attempts < 12) {
        retryTimer = window.setTimeout(() => void bootstrap(), 750);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [checking, connectorScope, pairing]);

  useEffect(() => {
    if (!status || status.relayConnected || relayPairingInFlight.current) return;
    relayPairingInFlight.current = true;
    const pairRelay = async () => {
      try {
        const response = await fetch("/api/local-connector/relay/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const body = (await response.json()) as { code?: string; error?: string };
        if (!response.ok || !body.code) {
          throw new Error(body.error || "Could not pair the connector relay.");
        }
        await connectorRequest("/v1/relay/pair", {
          method: "POST",
          body: JSON.stringify({ code: body.code }),
        });
        await refreshStatus();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Relay pairing failed.");
      } finally {
        relayPairingInFlight.current = false;
      }
    };
    void pairRelay();
  }, [connectorRequest, refreshStatus, status]);

  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (inFlight || pendingPreferenceWrites.current > 0) return;
      inFlight = true;
      const generation = ++statusRequestGeneration.current;
      try {
        const nextStatus = await readStatus();
        if (!cancelled && generation === statusRequestGeneration.current) {
          if (nextStatus) setStatus(nextStatus);
          setChecking(false);
        }
      } catch {
        if (!cancelled && generation === statusRequestGeneration.current) {
          setStatus(null);
          setChecking(false);
          localStorage.removeItem(pairingStorageKey(connectorScope));
          setPairing(null);
        }
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [connectorScope, pairing, readStatus]);

  const connectedProviders = useMemo(
    () => new Set(status?.providers.filter((item) => item.connected).map((item) => item.provider)),
    [status]
  );
  const modelGroups = useMemo(() => {
    return buildModelOptionGroups({ localProviders: status?.providers ?? [] });
  }, [status?.providers]);

  const persistPreviewPreferences = useCallback(
    (preferences: ConnectorStatus["preferences"]) => {
      localStorage.setItem(
        previewAiPreferencesKey(connectorScope),
        JSON.stringify(sanitizeConnectorPreferences(preferences))
      );
    },
    [connectorScope]
  );

  useEffect(() => {
    if (status) persistPreviewPreferences(status.preferences);
  }, [persistPreviewPreferences, status]);

  function updatePreferences(next: ConnectorStatus["preferences"]) {
    const preferences = sanitizeConnectorPreferences(next);
    const previous = status;
    const generation = ++preferenceMutationGeneration.current;
    statusRequestGeneration.current += 1;
    setStatus((current) =>
      current ? { ...current, preferences } : current
    );
    persistPreviewPreferences(preferences);
    pendingPreferenceWrites.current += 1;
    preferenceWriteChain.current = preferenceWriteChain.current.then(async () => {
      try {
        const response = await connectorRequest("/v1/preferences", {
          method: "PUT",
          body: JSON.stringify(preferences),
        });
        if (generation !== preferenceMutationGeneration.current) return;
        const saved = sanitizeConnectorPreferences(response.preferences);
        setStatus((current) =>
          current ? { ...current, preferences: saved } : current
        );
        persistPreviewPreferences(saved);
      } catch (error) {
        if (generation !== preferenceMutationGeneration.current) return;
        setStatus(previous);
        if (previous) persistPreviewPreferences(previous.preferences);
        toast.error(
          error instanceof Error ? error.message : "Could not save preferences"
        );
      } finally {
        pendingPreferenceWrites.current -= 1;
      }
    });
  }

  async function providerAction(providerStatus: ConnectorProviderStatus) {
    const operation = providerStatus.connected ? "logout" : "login";
    if (
      operation === "logout" &&
      !window.confirm(
        `Disconnect ${providerStatus.label}? This signs its CLI out on this device.`
      )
    ) {
      return;
    }
    setBusyProvider(providerStatus.provider);
    statusRequestGeneration.current += 1;
    try {
      await connectorRequest(
        `/v1/providers/${providerStatus.provider}/${operation}`,
        { method: "POST" }
      );
      await refreshStatus();
      toast.success(
        operation === "login"
          ? "Login requested; complete it in the provider window"
          : `${providerStatus.label} disconnected`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Provider action failed.");
    } finally {
      setBusyProvider(null);
    }
  }

  const anyConnected = connectedProviders.size > 0;
  const upgradeRequired = status ? connectorNeedsUpgrade(status.version) : false;

  return (
    <div className="space-y-6">
      <Card size="sm" className="gap-0 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <PlugZap className="text-primary size-4" />
              <h2 className="text-base font-semibold">Local AI accounts</h2>
              {status && (
                <Badge variant="outline" className="rounded-full">
                  <CheckCircle2 className="mr-1 size-3" /> Connector {status.version}
                </Badge>
              )}
              {status?.relayConnected && (
                <Badge variant="outline" className="rounded-full">
                  Preview relay ready
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Connect ChatGPT and Claude accounts through their official local CLIs.
              Credentials stay on this device.
            </p>
          </div>
          {((!status && !checking) || (status && upgradeRequired)) && (
            <LocalTerminalSetupGuide
              onRefresh={status ? () => void refreshStatus() : undefined}
            />
          )}
          {checking && (
            <Badge variant="outline" className="rounded-full">
              <LoaderCircle className="mr-1 size-3 animate-spin" /> Detecting
            </Badge>
          )}
        </div>

        {status && upgradeRequired && (
          <div className="border-amber-500/30 bg-amber-500/10 mt-4 rounded-xl border p-4">
            <p className="text-sm font-medium">Connector update required</p>
            <p className="text-muted-foreground mt-1 text-xs">
              Install version {CURRENT_CONNECTOR_VERSION} to load the real CLI model catalog, usage
              windows and Preview token totals. Your provider credentials remain
              on this device.
            </p>
          </div>
        )}

        {!status && !checking ? (
          <div className="bg-muted/40 mt-4 flex items-start gap-3 rounded-xl border p-4">
            <MonitorDown className="text-muted-foreground mt-0.5 size-5" />
            <div>
              <p className="text-sm font-medium">Connector not detected</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Use <span className="font-medium">Authorize from Terminal</span> to
                paste one command for your OS. It starts the connector and pairs
                this Member and Organization automatically. Requires Node.js 18+,
                runs per-user without administrator privileges, and needs no
                Vercel or Supabase access.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 divide-y rounded-xl border">
            {status?.providers.map((providerStatus) => {
              const busy = busyProvider === providerStatus.provider;
              return (
                <div
                  key={providerStatus.provider}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <ProviderBrandIcon
                    provider={providerStatus.provider}
                    className="text-muted-foreground size-6"
                  />
                  <div className="min-w-48 flex-1">
                    <p className="font-medium">{providerStatus.label}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {providerStatus.connected
                        ? [providerStatus.accountLabel, providerStatus.plan]
                            .filter(Boolean)
                            .join(" · ") ||
                          (providerStatus.provider === "openai"
                            ? "ChatGPT login detected; paid plan not verified"
                            : "Claude account authenticated")
                        : providerStatus.error ||
                          (providerStatus.available ? "Ready to connect" : "CLI not found")}
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded-full">
                    {providerStatus.connected
                      ? "Connected"
                      : providerStatus.connecting
                        ? "Connecting"
                        : providerStatus.available
                          ? "Available"
                          : "Unavailable"}
                  </Badge>
                  {providerStatus.connected && (
                    <UsageIndicator provider={providerStatus} />
                  )}
                  <Button
                    size="sm"
                    variant={providerStatus.connected ? "ghost" : "outline"}
                    disabled={!providerStatus.available || busy}
                    onClick={() => void providerAction(providerStatus)}
                  >
                    {busy || providerStatus.connecting ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : providerStatus.connected ? (
                      "Disconnect"
                    ) : (
                      "Connect"
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {status && anyConnected && (
        <>
          <section>
            <h2 className="mb-2 text-base font-semibold">Chat settings</h2>
            <Card size="sm" className="gap-0 divide-y py-0">
              <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-medium">Default model</p>
                  <p className="text-muted-foreground text-xs">
                    Local subscription model used by Preview conversations
                  </p>
                </div>
                <ModelPicker
                  value={status.preferences.defaultModel}
                  groups={modelGroups}
                  onChange={(value) =>
                    void updatePreferences({
                      ...status.preferences,
                      defaultModel: value,
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-medium">Follow-up behavior</p>
                  <p className="text-muted-foreground text-xs">
                    Queue follow-ups or use the newest message to steer the active reply
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full justify-between sm:w-72"
                      />
                    }
                  >
                    {status.preferences.followUpBehavior === "queue"
                      ? "Queue"
                      : "Steer"}
                    <ChevronDown className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    {(["queue", "steer"] as const).map((behavior) => (
                      <DropdownMenuItem
                        key={behavior}
                        onClick={() =>
                          void updatePreferences({
                            ...status.preferences,
                            followUpBehavior: behavior,
                          })
                        }
                      >
                        <span className="flex-1 capitalize">{behavior}</span>
                        {status.preferences.followUpBehavior === behavior && (
                          <Check className="size-4" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          </section>
        </>
      )}

      {status && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => void refreshStatus()}>
            <RotateCw className="size-4" /> Refresh connector
          </Button>
        </div>
      )}
    </div>
  );
}
