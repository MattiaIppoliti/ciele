// Day two: is my local Ciele up, and how do I stop it.
//
// Everything here reports what the stack is actually doing rather than what
// the app last asked it to do — the status comes from probing Ciele and from
// Docker, polled while this screen is open.

import { ArrowLeft, ExternalLink, Play, RotateCw, Square } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { bridge, navigate } from "../lib/bridge";
import { stackBridge } from "../lib/stack-bridge";
import { setupBridge } from "../lib/setup-bridge";
import { Button, Card, TitleBar } from "../components/ui";
import { cn } from "../lib/cn";
import type { StackHealth, StackStatus } from "../../shared/stack";

const HEALTH: Record<StackHealth, { label: string; blurb: string; dot: string }> = {
  running: {
    label: "Running",
    blurb: "Ciele is answering on this machine.",
    dot: "bg-accent",
  },
  starting: {
    label: "Starting",
    blurb: "The containers are up; Ciele is not answering yet. This can take a minute.",
    dot: "bg-ink-muted animate-pulse",
  },
  stopped: {
    label: "Stopped",
    blurb: "The stack is not running. Your data is untouched — starting it brings everything back.",
    dot: "bg-ink-muted/40",
  },
  "docker-unavailable": {
    label: "Docker unavailable",
    blurb: "Docker Desktop is not running, so the local stack cannot be reached. Start it and check again.",
    dot: "bg-danger",
  },
};

export function StackScreen(): ReactNode {
  const [status, setStatus] = useState<StackStatus | null>(null);

  useEffect(() => {
    void stackBridge().status().then(setStatus);
    return stackBridge().onStatus(setStatus);
  }, []);

  if (!status) return <div className="h-full" />;
  const health = HEALTH[status.health];

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-8 pb-10">
        <header className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => navigate("/welcome")} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-lg font-semibold">Local stack</h1>
        </header>

        <Card className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-2.5">
            <span className={cn("size-2 rounded-full", health.dot)} />
            <span className="text-sm font-medium" data-testid="stack-health">
              {health.label}
            </span>
          </div>
          <p className="text-sm text-ink-muted">{health.blurb}</p>
          {status.error ? (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {status.error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              disabled={status.busy || status.health === "running"}
              onClick={() => void stackBridge().start()}
            >
              <Play className="size-4" />
              Start
            </Button>
            <Button
              variant="secondary"
              disabled={status.busy || status.health === "stopped"}
              onClick={() => void stackBridge().stop()}
            >
              <Square className="size-4" />
              Stop
            </Button>
            <Button variant="ghost" onClick={() => void stackBridge().status()}>
              <RotateCw className="size-4" />
              Check again
            </Button>
            <Button
              variant="secondary"
              className="ml-auto"
              disabled={status.health !== "running"}
              onClick={() => void bridge().openProduct()}
            >
              Open Ciele
              <ExternalLink className="size-4" />
            </Button>
          </div>
        </Card>

        <Card className="flex flex-col gap-3 p-6 text-xs">
          <div className="flex justify-between gap-4">
            <span className="text-ink-muted">Address</span>
            <span className="font-mono">{status.url}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-ink-muted">Version</span>
            <span className="font-mono">{status.imageTag ?? "development build"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-ink-muted">Configuration</span>
            <span className="truncate font-mono" title={status.dataDir}>
              {status.dataDir}
            </span>
          </div>
          <p className="pt-1 text-ink-muted">
            Your assistants and knowledge live in Docker volumes, not in that folder — they
            survive restarts and app updates. Quitting Ciele leaves the stack running.
          </p>
        </Card>

        <Card className="flex flex-col gap-3 p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Run setup again</h2>
            <p className="text-xs text-ink-muted">
              Takes you back through the wizard from the first step. Your configuration, your
              database and your files are left exactly as they are — nothing here deletes data.
            </p>
          </div>
          <Button
            variant="secondary"
            className="self-start"
            data-testid="reset-setup"
            onClick={() => void setupBridge().reset()}
          >
            Run setup again
          </Button>
        </Card>
      </div>
    </div>
  );
}
