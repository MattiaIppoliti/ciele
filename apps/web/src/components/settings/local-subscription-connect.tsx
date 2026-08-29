"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card } from "@agent-hub/ui";
import type {
  LocalSubscriptionProvider,
  LocalSubscriptionStatus,
} from "@agent-hub/agent/client";

export function LocalSubscriptionConnect({
  provider,
  label,
}: {
  provider: LocalSubscriptionProvider;
  label: string;
}) {
  const [status, setStatus] = useState<LocalSubscriptionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const completed = useRef(false);

  const cancel = useCallback(() => {
    void fetch(`/api/local-subscriptions/${provider}`, {
      method: "PATCH",
      keepalive: true,
    });
  }, [provider]);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const finish = (next: LocalSubscriptionStatus) => {
      if (completed.current || !next.connected) return;
      completed.current = true;
      window.opener?.postMessage(
        { type: "local-subscription:connected", provider },
        window.location.origin
      );
      window.setTimeout(() => window.close(), 700);
    };

    const readStatus = async () => {
      const response = await fetch(`/api/local-subscriptions/${provider}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as LocalSubscriptionStatus & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "Status check failed.");
      if (cancelled) return;
      setStatus(body);
      if (body.error && !body.connecting) setError(body.error);
      finish(body);
    };

    const start = async () => {
      try {
        const response = await fetch(`/api/local-subscriptions/${provider}`, {
          method: "POST",
        });
        const body = (await response.json()) as LocalSubscriptionStatus & {
          error?: string;
        };
        if (!response.ok) throw new Error(body.error || "Login could not start.");
        if (cancelled) return;
        setStatus(body);
        if (!body.available) {
          setError(body.error || "The provider CLI is not available.");
          return;
        }
        finish(body);
        if (!body.connected) {
          interval = setInterval(() => void readStatus().catch(handleError), 1_000);
        }
      } catch (caught) {
        handleError(caught);
      }
    };

    const handleError = (caught: unknown) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : "Login failed.");
      }
    };

    window.addEventListener("pagehide", cancel);
    void start();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      window.removeEventListener("pagehide", cancel);
    };
  }, [cancel, provider]);

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md gap-0 p-6">
        <div className="inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">
          Local test connection
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          Connect {label}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Ciele is running the official provider CLI on this machine. Complete
          the real sign-in window opened by {provider === "openai" ? "Codex" : "Claude Code"},
          then return here. Credentials stay in the CLI&apos;s local credential
          store and are never copied into Ciele.
        </p>

        {status?.connected ? (
          <p className="mt-6 text-sm font-medium">
            Connected{status.accountLabel ? ` as ${status.accountLabel}` : ""}.
            This window will close automatically.
          </p>
        ) : status?.connecting ? (
          <p className="mt-6 text-sm font-medium">
            Waiting for provider sign-in…
          </p>
        ) : (
          <p className="text-muted-foreground mt-6 text-sm">
            Checking the local provider CLI…
          </p>
        )}

        {error && (
          <p className="text-destructive mt-4 text-sm" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              cancel();
              window.close();
            }}
          >
            Close
          </Button>
        </div>
      </Card>
    </div>
  );
}
