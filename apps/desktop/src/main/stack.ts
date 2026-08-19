// Running the local stack from the app rather than from Docker Desktop.
//
// The stack is detached: `up -d` and nothing holds a handle to it, so quitting
// Ciele leaves it running and the data in named volumes outlives both the app
// and an app update. That is deliberate, a local Ciele you have put knowledge
// into should not disappear because you closed a window.

import { BrowserWindow, ipcMain } from "electron";
import { broadcast } from "./broadcast";
import { composeArgs } from "../setup/compose";
import { STACK_CHANNELS, type StackHealth, type StackStatus } from "../shared/stack";
import type { SetupConfig, SetupPorts } from "../setup/ports";

/** How often the status screen re-checks while it is open. */
const POLL_INTERVAL_MS = 5_000;

export interface StackController {
  status(): StackStatus;
  refresh(): Promise<StackStatus>;
  start(): Promise<StackStatus>;
  stop(): Promise<StackStatus>;
}

/** Push a status to whichever native screen is open. */
function broadcastStatus(status: StackStatus): void {
  broadcast(STACK_CHANNELS.statusChanged, status);
}

export function createStackController(
  ports: SetupPorts,
  config: SetupConfig,
  onChange: (status: StackStatus) => void = broadcastStatus,
): StackController {
  let current: StackStatus = {
    health: "stopped",
    url: config.appUrl,
    dataDir: config.dataDir,
    imageTag: config.imageTag,
    error: null,
    busy: false,
  };

  function set(patch: Partial<StackStatus>): StackStatus {
    current = { ...current, ...patch };
    onChange(current);
    return current;
  }

  const compose = (args: readonly string[]) => composeArgs(config, args);

  async function health(): Promise<StackHealth> {
    if (!(await ports.docker.locate()) || !(await ports.docker.isRunning())) {
      return "docker-unavailable";
    }
    // Answering is the only thing that means "running": a container can be up
    // and still be replaying WAL, or crash-looping into a restart.
    const response = await ports.probe.get(config.appUrl);
    if (response && response.status < 500) return "running";

    const listed = await ports.docker.compose(compose(["ps", "--quiet"]));
    return listed.code === 0 && listed.output.trim() ? "starting" : "stopped";
  }

  async function refresh(): Promise<StackStatus> {
    // Never while a start or stop is mid-flight: the poll would report the
    // half-state it happens to catch and make the screen flicker.
    if (current.busy) return current;
    return set({ health: await health() });
  }

  return {
    status: () => current,
    refresh,
    async start() {
      set({ busy: true, error: null });
      const result = await ports.docker.compose(compose(["up", "-d"]));
      if (result.code !== 0) {
        set({ busy: false, error: lastLine(result.output) });
        return current;
      }
      set({ busy: false });
      return refresh();
    },
    async stop() {
      set({ busy: true, error: null });
      // `stop`, never `down`: `down` removes containers and invites a `-v`
      // that would take the user's data with it. Stopping is reversible.
      const result = await ports.docker.compose(compose(["stop"]));
      set({ busy: false, error: result.code === 0 ? null : lastLine(result.output) });
      return refresh();
    },
  };
}

/** Docker's failures put the useful sentence last. */
function lastLine(output: string): string {
  const lines = output.trim().split("\n").filter(Boolean);
  return lines.at(-1) ?? "The command failed.";
}

export function registerStackHandlers(controller: StackController): void {
  ipcMain.handle(STACK_CHANNELS.status, () => controller.refresh());
  ipcMain.handle(STACK_CHANNELS.start, () => controller.start());
  ipcMain.handle(STACK_CHANNELS.stop, () => controller.stop());

  // Polling only matters while someone is looking, and the native window is
  // the only thing that draws this. `refresh` already pushes through the
  // controller's onChange, so this must not push again, two identical
  // snapshots per tick is a re-render nobody asked for.
  setInterval(() => {
    if (BrowserWindow.getAllWindows().some((window) => !window.isDestroyed())) {
      void controller.refresh();
    }
  }, POLL_INTERVAL_MS).unref();
}
