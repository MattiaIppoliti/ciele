"use client";

import { createContext, useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { AgentScreen } from "@/components/agents/agent-screen";
import { FrameRailPanel } from "@/components/shell/frame-rail-panel";
import { SlotPortal, RIGHT_RAIL_SLOT } from "@/components/shell/slot-portal";
import { useShell } from "@/components/shell/shell-provider";
import { useTouchNavigation } from "@/components/shell/mobile-navigation";
import {
  Folder,
  FileText,
  Globe,
  Loader2,
  Minimize2,
  Monitor,
  RefreshCw,
  Square,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { Button, Dialog, DialogContent, DialogTitle } from "@agent-hub/ui";
import {
  teammateRuntimeConfig,
  type Teammate,
  type TurnStep,
} from "@agent-hub/core";
import {
  computerActivity,
  computerTurnActivity,
  computerFileSchema,
  computerFilesSchema,
  computerScreenSchema,
  computerStatusSchema,
  terminalActivity,
  type ComputerScreen,
  type ComputerStatus,
} from "@/lib/teammates/computer-view";

const tabs = [
  { id: "browser", label: "Browser", icon: Globe },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "files", label: "Files", icon: Folder },
] as const;
type Tab = (typeof tabs)[number]["id"];
const labels = {
  running: "Running",
  stopped: "Stopped",
  not_configured: "Service not connected",
  unavailable: "Unavailable",
};

type ScreenRenderer = (steps: TurnStep[], live: boolean) => ReactNode;
const ComputerScreenContext = createContext<ScreenRenderer | null>(null);

/** Only the authenticated Teammate host supplies computer observation to a reply. */
export function TeammateAgentScreen({ steps, live }: { steps: TurnStep[]; live: boolean }) {
  const renderScreen = useContext(ComputerScreenContext);
  return renderScreen?.(steps, live) ?? null;
}

/** A viewer of the teammate's owned computer. Requests to act use the normal audited chat turn. */
export function TeammateComputer({
  teammate,
  steps,
  busy,
  retired,
  onAsk,
  children,
}: {
  teammate: Teammate;
  steps: TurnStep[];
  busy: boolean;
  retired: boolean;
  onAsk: (text: string) => Promise<void>;
  children: ReactNode;
}) {
  const configured = teammateRuntimeConfig(teammate).computer;
  const enabled = Object.values(configured).some(Boolean);
  const { rightRail, openRightRail, closeRightRail } = useShell();
  const touch = useTouchNavigation();
  const open = rightRail === "workspace";
  const setOpen = (value: boolean) => {
    if (value) openRightRail("workspace");
    else {
      closeRightRail("workspace");
      workspaceButtonRef.current?.focus({ preventScroll: true });
    }
  };
  useEffect(() => () => closeRightRail("workspace"), [closeRightRail, teammate.id]);
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [screen, setScreen] = useState<ComputerScreen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reconnect, setReconnect] = useState(0);
  const [tab, setTab] = useState<Tab>("browser");
  const [expandedScreen, setExpandedScreen] = useState<string | null>(null);
  const [request, setRequest] = useState("");
  const [files, setFiles] = useState<ReturnType<
    typeof computerFilesSchema.parse
  > | null>(null);
  const [file, setFile] = useState<ReturnType<
    typeof computerFileSchema.parse
  > | null>(null);
  const epoch = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const endpoint = `/api/teammates/${encodeURIComponent(teammate.id)}/computer`;
  const activity = computerActivity(steps);
  const latestActivityId = activity.at(-1)?.id;
  const screenExpanded = activity.some(step => step.id === expandedScreen);
  const terminal = terminalActivity(steps);
  const granted = {
    browser: configured.browser && (status?.permissions.browser ?? true),
    files: configured.files && (status?.permissions.files ?? true),
    terminal: configured.terminal && (status?.permissions.terminal ?? true),
  };
  const mayAsk =
    !busy &&
    !retired &&
    (tab !== "terminal" || teammate.capabilityCeiling === "edit");

  const refresh = useEffectEvent(async (signal: AbortSignal) => {
    if (pending) return;
    const version = epoch.current;
    try {
      const response = await fetch(endpoint, { signal, cache: "no-store" });
      if (!response.ok)
        throw new Error(
          "Cannot connect to this teammate's workspace. Try again.",
        );
      const next = computerStatusSchema.parse(await response.json());
      if (signal.aborted || version !== epoch.current) return;
      setStatus(next);
      setError(null);
      if (!next.permissions.files) {
        setFiles(null);
        setFile(null);
      }
      if (next.state !== "running" || !next.permissions.browser) {
        setScreen(null);
        setScreenError(null);
        if (next.state !== "running" || !next.permissions.files) {
          setFiles(null);
          setFile(null);
        }
        return;
      }
      try {
        const capture = await fetch(`${endpoint}?view=screen`, {
          signal,
          cache: "no-store",
        });
        if (!capture.ok)
          throw new Error(
            "The browser screen is unavailable. Reconnect to try again.",
          );
        const frame = computerScreenSchema.parse(await capture.json());
        if (!signal.aborted && version === epoch.current) {
          setScreen(frame);
          setScreenError(null);
        }
      } catch (cause) {
        if (!signal.aborted && version === epoch.current) {
          setScreen(null);
          setScreenError(
            cause instanceof Error ? cause.message : "Screen unavailable",
          );
        }
      }
    } catch (cause) {
      if (!signal.aborted && version === epoch.current) {
        setStatus(null);
        setScreen(null);
        setFiles(null);
        setFile(null);
        setError(
          cause instanceof Error ? cause.message : "Workspace unavailable",
        );
      }
    }
  });
  useEffect(() => {
    if (!open && !screenExpanded && !enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const visible =
        open ||
        screenExpanded ||
        (cardRef.current &&
          cardRef.current.getBoundingClientRect().bottom > 0 &&
          cardRef.current.getBoundingClientRect().top < window.innerHeight);
      if (document.visibilityState === "visible" && visible)
        await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, open, screenExpanded, teammate.id, reconnect, latestActivityId]);

  async function lifecycle(action: "start" | "stop") {
    epoch.current++;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok)
        throw new Error(
          "Cannot change the computer state. Check saved permissions and the computer service.",
        );
      setScreen(null);
      setFiles(null);
      setFile(null);
      setStatus((previous) =>
        previous
          ? { ...previous, state: action === "start" ? "running" : "stopped" }
          : null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Computer unavailable");
    } finally {
      epoch.current++;
      setPending(false);
    }
  }
  async function loadFiles(path?: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `${endpoint}?view=${path ? "file" : "files"}&path=${encodeURIComponent(path ?? "")}`,
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error(
          "Cannot read this workspace. Check file access and the computer state.",
        );
      const raw: unknown = await response.json();
      if (path) setFile(computerFileSchema.parse(raw));
      else {
        setFiles(computerFilesSchema.parse(raw));
        setFile(null);
      }
    } catch (cause) {
      setFiles(null);
      setFile(null);
      setError(cause instanceof Error ? cause.message : "Files unavailable");
    } finally {
      setPending(false);
    }
  }
  function ask() {
    if (!request.trim() || !mayAsk) return;
    const text =
      tab === "terminal"
        ? `In your isolated workspace terminal, run this command and report the result:\n${request.trim()}`
        : `In your workspace browser, open this URL and report what you find:\n${request.trim()}`;
    if (touch) setOpen(false);
    setRequest("");
    void onAsk(text);
  }
  const message =
    error ??
    (status?.state === "not_configured"
      ? "Connect the computer service to see this teammate's workspace."
      : !Object.values(granted).some(Boolean)
        ? "Workspace access is disabled. An admin can enable it in teammate settings."
        : status?.state === "stopped"
          ? "The computer is stopped. Its saved files and browser profile are kept."
          : (screenError ??
            (!granted.browser
              ? "Browser access is disabled."
              : "Connecting to the teammate's screen…")));
  // Real per-frame data URLs bypass image optimization and never expose a computer URL/token.
  const image = screen && granted.browser ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`data:image/png;base64,${screen.base64}`}
      alt={`${teammate.name}'s browser screen`}
      width={screen.width}
      height={screen.height}
      className="h-full w-full object-contain"
    />
  ) : (
    <div
      role="status"
      className="flex h-full min-h-40 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-white/70"
    >
      {!error &&
        !screenError &&
        (!status || status.state === "running") &&
        granted.browser && (
          <Loader2
            className="size-6 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        )}
      <p>{message}</p>
    </div>
  );
  const controls = (
    <>
      {status?.canManage &&
        Object.values(granted).some(Boolean) &&
        status.state !== "not_configured" && (
          <Button
            type="button"
            size="sm"
            variant={status.state === "running" ? "destructive" : "outline"}
            className="min-h-[44px]"
            disabled={pending}
            onClick={() =>
              void lifecycle(status.state === "running" ? "stop" : "start")
            }
          >
            {status.state === "running" ? (
              <>
                <Square size={14} />
                Stop computer
              </>
            ) : (
              "Start computer"
            )}
          </Button>
        )}
    </>
  );
  function renderScreen(turnSteps: TurnStep[], live: boolean) {
    const turn = computerTurnActivity(turnSteps, { latestCallId: latestActivityId, live });
    if (!turn) return null;
    const command = terminalActivity([turn.step]).at(0);
    return (
      <AgentScreen
        agentName={teammate.name}
        frame={image}
        live={turn.live}
        current={turn.current}
        cardRef={turn.current ? cardRef : undefined}
        open={expandedScreen === turn.id}
        onOpenChange={next => setExpandedScreen(next ? turn.id : null)}
        onOpenWorkspace={() => setOpen(true)}
        activity={(
          <>
            <p role="status" className="truncate">{turn.step.label} · {turn.status}</p>
            {screen && granted.browser && turn.current && (
              <p className="mt-1 truncate">
                Browser capture · <time dateTime={screen.capturedAt}>{new Date(screen.capturedAt).toLocaleTimeString()}</time>
              </p>
            )}
            {command && (
              <div className="mt-2 font-mono">
                <p className="truncate">$ {typeof command.input?.command === "string" ? command.input.command : command.label}</p>
                {command.result && (
                  <details className="mt-1">
                    <summary className="press-text min-h-[44px] cursor-pointer py-3 font-sans">Command result</summary>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-2">
                      {JSON.stringify(command.result.output ?? command.result, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      />
    );
  }
  const workspaceViews = (
    <>
      <div
        role="tablist"
        aria-label="Workspace views"
        className="flex shrink-0 gap-1 border-b px-4 py-2"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            tabIndex={tab === item.id ? 0 : -1}
            onKeyDown={(event) => {
              const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              const index = tabs.findIndex((entry) => entry.id === tab);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              const target = tabs[next];
              if (target) {
                setTab(target.id);
                setRequest("");
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>("[role=tab]")
                  [next]?.focus();
              }
            }}
            aria-selected={tab === item.id}
            aria-controls={`workspace-${teammate.id}-${item.id}`}
            id={`workspace-tab-${teammate.id}-${item.id}`}
            className={`flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm ${tab === item.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`}
            onClick={() => {
              setTab(item.id);
              setRequest("");
            }}
          >
            {<item.icon size={16} />}
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        aria-labelledby={`workspace-tab-${teammate.id}-${tab}`}
        id={`workspace-${teammate.id}-${tab}`}
        className="@container/workspace flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-5"
      >
        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {tab === "browser" && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Globe size={16} />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {screen?.url ?? "Browser screen"}
              </span>
              {screen && (
                <time
                  dateTime={screen.capturedAt}
                  className="text-xs text-muted-foreground"
                >
                  Captured{" "}
                  {new Date(screen.capturedAt).toLocaleTimeString()}
                </time>
              )}
            </div>
            <div className="min-h-48 flex-1 overflow-hidden rounded-xl border bg-black">
              {image}
            </div>
          </>
        )}
        {tab === "terminal" && (
          <div
            className="min-h-48 flex-1 overflow-auto rounded-xl border bg-black p-4 font-mono text-sm text-zinc-100"
            aria-label="Terminal activity"
          >
            {terminal.length === 0 ? (
              <p className="text-zinc-400">
                No terminal commands in this conversation yet.
              </p>
            ) : (
              terminal.map((step) => (
                <div key={step.id} className="mb-4">
                  <p>
                    ${" "}
                    {typeof step.input?.command === "string"
                      ? step.input.command
                      : step.label}
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-zinc-300">
                    {step.result
                      ? JSON.stringify(
                          step.result.output ?? step.result,
                          null,
                          2,
                        )
                      : (step.detail ?? step.status)}
                  </pre>
                </div>
              ))
            )}
          </div>
        )}
        {tab === "files" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Saved workspace files
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                disabled={
                  pending || !granted.files || status?.state !== "running"
                }
                onClick={() => void loadFiles()}
              >
                <RefreshCw size={14} />
                Refresh files
              </Button>
            </div>
            {!granted.files && (
              <p className="text-sm text-muted-foreground">
                File access is disabled.
              </p>
            )}
            {files && (
              <div className="grid min-h-0 flex-1 gap-3 @lg/workspace:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div className="overflow-auto rounded-xl border p-2">
                  {files.entries.length === 0 && (
                    <p className="p-3 text-sm text-muted-foreground">
                      No files yet.
                    </p>
                  )}
                  {files.entries.map((entry) =>
                    entry.kind === "folder" ? (
                      <p
                        key={entry.path}
                        className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
                      >
                        <Folder size={14} />
                        {entry.path}
                      </p>
                    ) : (
                      <button
                        key={entry.path}
                        type="button"
                        disabled={pending}
                        className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-muted"
                        onClick={() => void loadFiles(entry.path)}
                      >
                        <FileText size={14} />
                        <span className="min-w-0 truncate">
                          {entry.path}
                        </span>
                      </button>
                    ),
                  )}
                  {files.truncated && (
                    <p className="p-3 text-xs text-muted-foreground">
                      The file list is truncated.
                    </p>
                  )}
                </div>
                <div className="min-h-48 overflow-auto rounded-xl border bg-muted/30 p-4">
                  {file ? (
                    <>
                      <h3 className="mb-3 break-all text-sm font-medium">
                        {file.path}
                      </h3>
                      <pre className="whitespace-pre-wrap break-words text-xs">
                        {file.text}
                      </pre>
                      {file.truncated && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Showing the first part of this file.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Select a file to read it.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {tab !== "files" && (
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              ask();
            }}
          >
            <input
              type={tab === "browser" ? "url" : "text"}
              style={{ fontSize: "16px" }}
              aria-label={
                tab === "browser"
                  ? "URL for the teammate"
                  : "Command for the teammate"
              }
              placeholder={
                tab === "browser"
                  ? "https://example.com"
                  : "Ask the teammate to run a command…"
              }
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              disabled={!mayAsk || !granted[tab]}
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border bg-background px-3 text-base"
            />
            <Button
              type="submit"
              className="min-h-[44px]"
              disabled={!mayAsk || !granted[tab] || !request.trim()}
            >
              Ask teammate
            </Button>
          </form>
        )}
        {tab !== "files" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Requests run through this teammate&apos;s chat and permissions.
            Stop computer interrupts its work; it keeps the workspace.
          </p>
        )}
        {activity.length > 0 && (
          <details className="mt-3 rounded-lg border px-3 py-2 text-xs">
            <summary className="cursor-pointer py-2">
              Recent computer activity ({activity.length})
            </summary>
            {activity.slice(-8).map((step) => (
              <p key={step.id} className="py-1">
                {step.label} · {step.status}
                {step.detail ? ` · ${step.detail}` : ""}
              </p>
            ))}
          </details>
        )}
        {status?.canManage && status.state !== "running" && (
          <Link
            href={`/teammates/${encodeURIComponent(teammate.id)}/settings`}
            onClick={() => setOpen(false)}
            className="mt-3 text-sm underline underline-offset-4"
          >
            Workspace permissions
          </Link>
        )}
      </div>
    </>
  );
  return (
    <>
        <div className="flex shrink-0 justify-end px-4 pt-3">
          <Button
            ref={workspaceButtonRef}
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-[44px]"
            onClick={() => setOpen(true)}
            aria-expanded={open}
          >
            <Monitor size={16} />
            Workspace
          </Button>
        </div>
      <ComputerScreenContext.Provider value={renderScreen}>{children}</ComputerScreenContext.Provider>
      <SlotPortal id={RIGHT_RAIL_SLOT}>
        <AnimatePresence initial={false}>
          {open && !touch && (
            <FrameRailPanel
              key="workspace"
              title={`${teammate.name}'s workspace`}
              labels={{ panel: "Teammate workspace", hide: "Close workspace", resize: "Resize workspace" }}
              onClose={() => setOpen(false)}
            >
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span role="status" className="text-xs text-muted-foreground">
                  {status ? labels[status.state] : "Connecting"}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="min-h-[44px] min-w-[44px]"
                    aria-label="Reconnect workspace"
                    disabled={pending}
                    onClick={() => setReconnect(value => value + 1)}
                  >
                    <RefreshCw size={16} />
                  </Button>
                  {controls}
                </div>
              </div>
              {workspaceViews}
            </FrameRailPanel>
          )}
        </AnimatePresence>
      </SlotPortal>
      <Dialog open={open && touch} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          overlayClassName="z-[75]"
          className="teammate-computer-view motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none z-[80] flex h-dvh max-h-none w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none bg-background p-0 sm:max-w-none"
        >
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 pt-[env(safe-area-inset-top)]">
            <div className="flex min-w-0 items-center gap-3">
              <DialogTitle className="truncate text-base">
                {teammate.name}&apos;s workspace
              </DialogTitle>
              <span role="status" className="text-xs text-muted-foreground">
                {status ? labels[status.state] : "Connecting"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="min-h-[44px] min-w-[44px]"
                aria-label="Reconnect workspace"
                disabled={pending}
                onClick={() => setReconnect((value) => value + 1)}
              >
                <RefreshCw size={16} />
              </Button>
              {controls}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="min-h-[44px] min-w-[44px]"
                aria-label="Close workspace"
                onClick={() => setOpen(false)}
              >
                <Minimize2 size={18} />
              </Button>
            </div>
          </header>
          {workspaceViews}
        </DialogContent>
      </Dialog>
    </>
  );
}
