// Driving Docker from a GUI app.
//
// The trap this exists for: a macOS app launched from the Finder or the Dock
// does NOT inherit the shell's PATH. It gets a bare `/usr/bin:/bin:/usr/sbin:
// /sbin`, which contains no `docker`, so a naive `spawn("docker", …)` fails
// with ENOENT on a machine where Docker Desktop is installed and running and
// the user's terminal finds it instantly. That reads as "Ciele is broken", and
// it would be the very first thing a new user hit.
//
// So the CLI is located explicitly, in the places Docker Desktop and the
// common package managers actually put it, before anything is run.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { CommandResult, DockerPort } from "../../setup/ports";

/**
 * Where `docker` lives, most likely first. PATH wins, a developer's or a
 * deliberate install's choice beats our guesses, then the places Docker
 * Desktop and the common package managers actually put it.
 *
 * macOS: Docker Desktop symlinks into /usr/local/bin and also keeps a copy
 * inside the app bundle; Homebrew on Apple silicon uses /opt/homebrew; recent
 * Docker Desktop versions default to a per-user ~/.docker/bin.
 *
 * Windows: the machine-wide install keeps the CLI under Program Files, the
 * per-user installer under LocalAppData\Programs. Paths are built with the
 * platform's own separators, so the Windows list is testable from any host.
 */
export function candidatePaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): string[] {
  if (platform === "win32") {
    const win = path.win32;
    const fromPath = (env.PATH ?? "")
      .split(";")
      .filter(Boolean)
      .map((dir) => win.join(dir, "docker.exe"));
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const machineWide = win.join(programFiles, "Docker", "Docker", "resources", "bin", "docker.exe");
    const perUser = env.LOCALAPPDATA
      ? [win.join(env.LOCALAPPDATA, "Programs", "Docker", "Docker", "resources", "bin", "docker.exe")]
      : [];
    return [...fromPath, machineWide, ...perUser];
  }

  const posix = path.posix;
  const home = env.HOME ?? homedir();
  const fromPath = (env.PATH ?? "")
    .split(":")
    .filter(Boolean)
    .map((dir) => posix.join(dir, "docker"));
  return [
    ...fromPath,
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    posix.join(home, ".docker/bin/docker"),
    "/Applications/Docker.app/Contents/Resources/bin/docker",
    "/usr/bin/docker",
  ];
}

/** How long a Docker call may take before it is treated as hung. */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export interface DockerPortOptions {
  /** Directory compose runs in, the bundled deploy assets. */
  cwd: string;
  timeoutMs?: number;
}

export function createDockerPort(options: DockerPortOptions): DockerPort {
  let cached: string | null | undefined;

  async function locate(): Promise<string | null> {
    if (cached !== undefined) return cached;
    cached = candidatePaths().find((candidate) => existsSync(candidate)) ?? null;
    return cached;
  }

  async function run(
    args: readonly string[],
    onOutput?: (chunk: string) => void,
    timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  ): Promise<CommandResult> {
    const binary = await locate();
    if (!binary) throw new Error("Docker Desktop is not installed.");

    return new Promise<CommandResult>((resolve) => {
      const child = spawn(binary, args, {
        cwd: options.cwd,
        // Compose writes progress to stderr, so both streams are one log, the
        // user reading it does not care which fd a line came from.
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          // Compose's fancy progress rendering is meant for a TTY; without
          // this it emits cursor-control escapes into a log nobody can read.
          COMPOSE_ANSI: "never",
          DOCKER_CLI_HINTS: "false",
        },
      });

      let output = "";
      let settled = false;
      const collect = (chunk: Buffer) => {
        const text = chunk.toString();
        output += text;
        onOutput?.(text);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        output += "\nTimed out.";
      }, timeoutMs);

      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, output });
      };
      child.on("error", (cause) => {
        output += `\n${cause.message}`;
        finish(1);
      });
      child.on("close", (code) => finish(code ?? 1));
    });
  }

  return {
    locate,
    async isRunning() {
      // Installed and running are different states: `info` talks to the
      // daemon, `--version` only reads the client binary.
      const result = await run(["info", "--format", "{{.ServerVersion}}"], undefined, 20_000).catch(
        () => null,
      );
      return result?.code === 0;
    },
    compose: (args, onOutput) => run(["compose", ...args], onOutput),
  };
}
