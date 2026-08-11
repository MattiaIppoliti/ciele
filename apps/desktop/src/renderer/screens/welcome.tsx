// The first screen: the two ways to use Ciele, side by side.
//
// Both are offered equally on purpose. A prospective user should see that
// running it locally is a real option, not a footnote — and an admin with a
// subscription should not have to hunt for sign-in.

import { Building2, HardDrive, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import { bridge, navigate } from "../lib/bridge";
import { Button, Card, TitleBar } from "../components/ui";
import type { AppState } from "../../shared/state";

function Path({
  icon,
  title,
  blurb,
  action,
  onClick,
  footnote,
}: {
  icon: ReactNode;
  title: string;
  blurb: string;
  action: string;
  onClick: () => void;
  footnote: string;
}): ReactNode {
  return (
    <Card className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex size-10 items-center justify-center rounded-xl bg-surface-raised text-accent">
        {icon}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm leading-relaxed text-ink-muted">{blurb}</p>
      </div>
      <div className="mt-auto flex flex-col gap-2 pt-2">
        <Button onClick={onClick}>{action}</Button>
        <p className="text-xs text-ink-muted">{footnote}</p>
      </div>
    </Card>
  );
}

export function WelcomeScreen({ state }: { state: AppState }): ReactNode {
  const host = new URL(state.settings.saasBaseUrl).host;
  return (
    <div className="flex h-full flex-col">
      <TitleBar>
        <Button variant="ghost" onClick={() => navigate("/settings")} aria-label="Settings">
          <Settings2 className="size-4" />
        </Button>
      </TitleBar>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-8 pb-12">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to Ciele</h1>
          <p className="text-sm text-ink-muted">
            Connect to your organization, or run the whole product on this machine. You can
            switch later, and both can coexist.
          </p>
        </header>

        <div className="flex gap-4">
          <Path
            icon={<Building2 className="size-5" />}
            title="Sign in to your organization"
            blurb="Open your organization's console in a window of its own. Your session is remembered, so this is a once-only step."
            action="Sign in"
            onClick={() => void bridge().chooseMode("saas")}
            footnote={`Connecting to ${host}. Change it in settings to reach a self-hosted server.`}
          />
          <Path
            icon={<HardDrive className="size-5" />}
            title="Use locally (self-host)"
            blurb="Set up a complete Ciele on this machine — database, jobs and all. Guided, with no terminal; Docker Desktop is the one thing you install yourself."
            action="Set up locally"
            onClick={() => void bridge().chooseMode("local")}
            footnote="Your data stays on this machine and survives app updates."
          />
        </div>
      </div>
    </div>
  );
}
