// "That address did not load" — the app's own screen, not the browser's.
//
// A window with no address bar and no reload button has nothing a user can
// press when a page fails. Whatever the product window could not load, they
// end up here instead, looking at the address that was tried and three things
// they can do about it.

import { ArrowLeft, RotateCw, Settings2, Unplug } from "lucide-react";
import type { ReactNode } from "react";
import { bridge, navigate } from "../lib/bridge";
import { Button, Card, TitleBar } from "../components/ui";
import type { AppState } from "../../shared/state";

export function UnreachableScreen({ state }: { state: AppState }): ReactNode {
  const error = state.productError;
  const isLocal = state.settings.mode === "local";

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-8 pb-12">
        <Card className="flex flex-col gap-4 p-8">
          <div className="flex size-10 items-center justify-center rounded-xl bg-surface-raised text-danger">
            <Unplug className="size-5" />
          </div>

          <h1 className="text-lg font-semibold">Ciele did not load</h1>

          <p className="text-sm leading-relaxed text-ink-muted" data-testid="unreachable-reason">
            {error?.reason ?? "The server could not be reached."}
          </p>

          {error ? (
            <p
              className="truncate rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink-muted"
              title={error.url}
              data-testid="unreachable-url"
            >
              {error.url}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button onClick={() => void bridge().openProduct()} data-testid="unreachable-retry">
              <RotateCw className="size-4" />
              Try again
            </Button>
            {isLocal ? (
              <Button variant="secondary" onClick={() => navigate("/stack")}>
                Stack status
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => navigate("/settings")}
                data-testid="unreachable-settings"
              >
                <Settings2 className="size-4" />
                Change address
              </Button>
            )}
            <Button variant="ghost" className="ml-auto" onClick={() => navigate("/welcome")}>
              <ArrowLeft className="size-4" />
              Welcome
            </Button>
          </div>
        </Card>

        <p className="text-xs text-ink-muted">
          {isLocal
            ? "Your local stack may still be starting. The stack screen shows what it is doing."
            : "If your organization runs its own Ciele, set its address in settings."}
        </p>
      </div>
    </div>
  );
}
