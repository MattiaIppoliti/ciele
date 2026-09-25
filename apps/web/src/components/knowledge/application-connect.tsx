"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@agent-hub/ui";
import type { ApplicationProvider } from "@agent-hub/core";
import { APP_BRANDS, AppBrandMark } from "@/components/ui/app-brand";
import { GhostMark } from "@/components/auth/ghost-mark";

type SharedProvider = Exclude<ApplicationProvider, "salesforce" | "servicenow">;

const PROVIDER_DESTINATIONS: Record<SharedProvider, string> = {
  slack: "slack.com",
  onedrive: "login.microsoftonline.com",
  google_drive: "accounts.google.com",
  microsoft_mail: "login.microsoftonline.com",
};

export function ApplicationConnect({
  provider,
  returnTo,
  connectionId,
  organizationName,
  configured,
  showSetupGuide,
}: {
  provider: SharedProvider;
  returnTo: string;
  connectionId?: string;
  organizationName: string;
  configured: boolean;
  showSetupGuide: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = APP_BRANDS[provider].label;

  async function connect() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/applications/oauth/${provider}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnTo, connectionId }),
      });
      if (!response.ok || response.redirected) {
        throw new Error("The connection could not start. Refresh this page and try again.");
      }
      const { authorizationUrl } = await response.json() as { authorizationUrl: string };
      window.location.assign(authorizationUrl);
    } catch {
      setError("The connection could not start. Refresh this page and try again.");
      setPending(false);
    }
  }

  function cancel() {
    if (window.opener) window.close();
    // Also works in a regular tab, or when the browser refuses window.close().
    window.location.assign(returnTo);
  }

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <div className="flex min-h-full flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-8 text-center">
          <div className="flex items-center justify-center gap-4" aria-hidden="true">
            <div className="flex size-14 items-center justify-center rounded-xl border bg-card">
              <GhostMark className="size-9" />
            </div>
            <ArrowRight className="size-5 text-muted-foreground" />
            <AppBrandMark provider={provider} size="size-14" className="rounded-xl" />
          </div>
          <div className="space-y-3">
            <p className="font-brand text-xl">Ciele</p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {configured ? `Connect ${label} to Ciele` : `${label} needs to be enabled`}
            </h1>
            <p className="text-sm text-muted-foreground">{organizationName}</p>
            <p className="text-balance text-muted-foreground">
              {configured
                ? `Continue to ${label} to sign in and choose which access to allow. When you finish, you will return to Ciele.`
                : `This Ciele deployment is not set up to connect to ${label} yet. Ask the person who manages Ciele to enable this connection.`}
            </p>
          </div>
          {configured ? (
            <div className="space-y-4">
              <details className="rounded-xl border bg-card px-4 py-3 text-sm">
                <summary className="press-text cursor-pointer text-muted-foreground">Show destination</summary>
                <p className="mt-3 break-all font-mono">{PROVIDER_DESTINATIONS[provider]}</p>
              </details>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button className="w-full" onClick={connect} disabled={pending}>
                {pending && <LoaderCircle className="size-4 animate-spin" />}
                {pending ? `Opening ${label}…` : "Continue connecting"}
              </Button>
            </div>
          ) : showSetupGuide ? (
            <a
              href="https://docs.ciele.app/knowledge/applications#configure-oauth-for-a-self-hosted-deployment"
              target="_blank"
              rel="noopener noreferrer"
              className="press-text inline-block text-sm underline underline-offset-4"
            >
              View connection setup guide
            </a>
          ) : null}
          <Button variant="ghost" onClick={cancel} disabled={pending}>
            {configured ? "Not now" : "Back to Ciele"}
          </Button>
        </div>
      </div>
    </main>
  );
}
