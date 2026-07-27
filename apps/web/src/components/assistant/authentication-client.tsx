"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  EntraSsoConfig,
  SsoProviderKind,
  SsoValidationStatus,
} from "@agent-hub/core";
import { toast } from "@/lib/toast";
import {
  Badge,
  Button,
  Card,
  CopyFeedbackIcon,
  Input,
  Label,
  PasswordInput,
  useCopyFeedback,
} from "@agent-hub/ui";
import { Switch } from "@/components/ui/switch";
import {
  disconnectSsoConnectionAction,
  setAssistantRequireSignInAction,
  setSsoConnectionAction,
  validateSsoConnectionAction,
} from "@/app/actions";

/** window.location.origin never changes at runtime. */
const NOOP_SUBSCRIBE = () => () => {};

interface ConnectionView {
  provider: SsoProviderKind;
  config: EntraSsoConfig;
  validationStatus: SsoValidationStatus;
}

const PROVIDERS: Array<{
  kind: SsoProviderKind;
  label: string;
  available: boolean;
}> = [
  { kind: "entra", label: "Microsoft Entra ID", available: true },
  { kind: "clerk", label: "Clerk", available: false },
  { kind: "workos", label: "WorkOS", available: false },
];

function CopyField({ label, value }: { label: string; value: string }) {
  const { copyText, isCopied } = useCopyFeedback<string>();
  const copied = isCopied(value);

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code className="bg-muted text-muted-foreground min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-xs">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={copied ? `${label} copied` : `Copy ${label}`}
          onClick={() => void copyText(value, value)}
        >
          <CopyFeedbackIcon copied={copied} className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: SsoValidationStatus }) {
  if (status === "valid") return <Badge variant="default">Validated</Badge>;
  if (status === "invalid") return <Badge variant="destructive">Invalid</Badge>;
  return <Badge variant="secondary">Not validated</Badge>;
}

export function AuthenticationClient({
  assistantId,
  requireSignIn,
  connection,
  canManageConnection,
  canEdit,
}: {
  assistantId: string;
  requireSignIn: boolean;
  connection: ConnectionView | null;
  canManageConnection: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clientId, setClientId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const origin = useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => window.location.origin,
    () => "https://your-app.example"
  );
  const redirectUri = `${origin}/api/sso/entra/callback`;
  const logoutUri = `${origin}/api/sso/entra/logout`;

  const run = (fn: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await fn();
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });

  const connect = () =>
    run(async () => {
      const result = await setSsoConnectionAction(assistantId, {
        provider: "entra",
        clientId,
        tenantId,
        clientSecret,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setClientId("");
      setTenantId("");
      setClientSecret("");
      toast.success("Connection saved — validate it to confirm the credentials.");
      router.refresh();
    });

  const validate = () =>
    run(async () => {
      const result = await validateSsoConnectionAction(assistantId);
      if (result.ok) toast.success("Connection validated.");
      else toast.error(result.error ?? "Validation failed.");
      router.refresh();
    });

  const disconnect = () =>
    run(async () => {
      await disconnectSsoConnectionAction(assistantId);
      toast.success("Provider disconnected.");
      router.refresh();
    });

  const toggleEnforce = (next: boolean) =>
    run(async () => {
      await setAssistantRequireSignInAction(assistantId, next);
      router.refresh();
    });

  const enforceableWithoutValid =
    requireSignIn &&
    (!connection || connection.validationStatus !== "valid");

  return (
    <div className="mt-6 space-y-6">
      {/* Provider picker */}
      <Card size="sm" className="gap-0 p-4">
        <h2 className="text-base font-semibold">Identity provider</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose the provider your visitors will sign in with.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {PROVIDERS.map((p) => {
            const active = connection?.provider === p.kind;
            return (
              <div
                key={p.kind}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                  active ? "border-foreground" : "border-border"
                } ${p.available ? "" : "opacity-60"}`}
              >
                <span className="font-medium">{p.label}</span>
                {active && <StatusBadge status={connection.validationStatus} />}
                {!p.available && <Badge variant="secondary">Coming soon</Badge>}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Microsoft Entra ID setup / connection */}
      <Card size="sm" className="gap-0 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Microsoft Entra ID</h2>
          {connection && <StatusBadge status={connection.validationStatus} />}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Register an app in the Entra admin center, then paste its credentials
          here. Add these URLs to the app&apos;s <strong>Web</strong> platform
          first.
        </p>

        <div className="mt-4 grid gap-3">
          <CopyField label="Redirect URI" value={redirectUri} />
          <CopyField label="Front-channel logout URL" value={logoutUri} />
        </div>

        {connection ? (
          <div className="mt-6 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Application (client) ID</Label>
                <code className="bg-muted block truncate rounded-md px-2.5 py-1.5 text-xs">
                  {connection.config.clientId}
                </code>
              </div>
              <div className="space-y-1.5">
                <Label>Directory (tenant) ID</Label>
                <code className="bg-muted block truncate rounded-md px-2.5 py-1.5 text-xs">
                  {connection.config.tenantId}
                </code>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              Client secret is stored securely and never shown again.
            </p>
            {canManageConnection && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={validate} disabled={isPending}>
                  Validate connection
                </Button>
                <Button
                  variant="ghost"
                  onClick={disconnect}
                  disabled={isPending}
                >
                  Disconnect
                </Button>
              </div>
            )}
          </div>
        ) : canManageConnection ? (
          <div className="mt-6 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sso-client-id">Application (client) ID</Label>
              <Input
                id="sso-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-tenant-id">Directory (tenant) ID</Label>
              <Input
                id="sso-tenant-id"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sso-client-secret">Client secret</Label>
              <PasswordInput
                id="sso-client-secret"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Value from Certificates & secrets"
              />
            </div>
            <Button
              onClick={connect}
              disabled={
                isPending || !clientId.trim() || !tenantId.trim() || !clientSecret.trim()
              }
            >
              Connect
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground mt-6 text-sm">
            You don&apos;t have permission to manage this organization&apos;s SSO
            connection.
          </p>
        )}
      </Card>

      {/* Enforcement */}
      <Card size="sm" className="gap-0 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Require sign-in</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              When on, visitors must sign in before this assistant will chat.
            </p>
          </div>
          <Switch
            checked={requireSignIn}
            disabled={!canEdit || isPending}
            onCheckedChange={toggleEnforce}
          />
        </div>
        {enforceableWithoutValid && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Sign-in is required but there is no validated connection yet —
            visitors won&apos;t be able to get past the gate until you connect
            and validate a provider.
          </p>
        )}
      </Card>
    </div>
  );
}
