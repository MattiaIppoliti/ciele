// Settings: the base URL, the current mode, and how to leave it.
//
// The base URL is what makes one app serve both the hosted product and a
// self-hosted server, the sign-in path is "load this origin", so pointing it
// somewhere else is the whole of remote self-host support.

import { ArrowLeft } from "lucide-react";
import { useState, type ReactNode } from "react";
import { bridge, navigate } from "../lib/bridge";
import { Button, Card, Field, Input, TitleBar } from "../components/ui";
import { DEFAULT_SAAS_BASE_URL, type AppState } from "../../shared/state";

export function SettingsScreen({ state }: { state: AppState }): ReactNode {
  const [value, setValue] = useState(state.settings.saasBaseUrl);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      const next = await bridge().setSaasBaseUrl(value);
      setValue(next.settings.saasBaseUrl);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That address could not be used.");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-8 pb-10">
        <header className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate("/welcome")} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-lg font-semibold">Settings</h1>
        </header>

        <Card className="flex flex-col gap-4 p-6">
          <Field
            label="Server address"
            hint="Where “Sign in to your organization” connects. Point it at your own server to use this app with a self-hosted Ciele."
            error={error}
          >
            <Input
              value={value}
              spellCheck={false}
              autoCapitalize="off"
              placeholder={DEFAULT_SAAS_BASE_URL}
              onChange={(event) => {
                setValue(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
          <div className="flex items-center gap-3">
            <Button onClick={() => void save()}>Save</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setValue(DEFAULT_SAAS_BASE_URL);
                setSaved(false);
              }}
            >
              Reset to default
            </Button>
            {saved ? <span className="text-xs text-accent">Saved</span> : null}
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">This session</h2>
            <p className="text-xs text-ink-muted">
              {state.settings.mode === null
                ? "No mode chosen yet."
                : state.settings.mode === "saas"
                  ? "Signed in to your organization. Signing out clears this app's stored session for it."
                  : "Using the local stack. Signing out returns to the welcome screen; the stack keeps running."}
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              disabled={state.settings.mode === null}
              onClick={() => void bridge().openProduct()}
            >
              Open Ciele
            </Button>
            {state.settings.mode === "local" ? (
              <Button variant="secondary" onClick={() => navigate("/stack")}>
                Local stack
              </Button>
            ) : null}
            <Button
              variant="danger"
              disabled={state.settings.mode === null}
              onClick={() => void bridge().signOut()}
            >
              Sign out
            </Button>
          </div>
        </Card>

        <p className="text-xs text-ink-muted">Ciele Desktop {state.version}</p>
      </div>
    </div>
  );
}
