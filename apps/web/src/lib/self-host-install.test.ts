import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_FORWARDED_FLAGS,
  BOOTSTRAP_INTERPRETER,
  BOOTSTRAP_RELATIVE_PATH,
  BOOTSTRAP_REQUIRED_COMMANDS,
  DEFAULT_CHECKOUT_DIR,
  INSTALL_SCRIPT_PATH,
  buildSelfHostInstallScript,
  normalizeSourceUrl,
  selfHostInstallCommand,
} from "./self-host-install";

const ORIGIN = "https://ciele.example.com";
const REPO = "https://github.com/example/ciele";

/** `<root>/apps/web/src/lib/` → `<root>/`. Resolved from this file rather than
 *  cwd so the contract test holds however vitest is invoked. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BOOTSTRAP_PATH = join(REPO_ROOT, BOOTSTRAP_RELATIVE_PATH);

describe("selfHostInstallCommand", () => {
  it("is a single copy-paste line", () => {
    expect(selfHostInstallCommand(ORIGIN)).toBe(
      "curl -fsSL https://ciele.example.com/install.sh | sh"
    );
  });

  it("rejects an origin that is not safe to paste into a shell", () => {
    // Plaintext on a real host, and credentials that would land in history.
    expect(() => selfHostInstallCommand("http://ciele.example.com")).toThrow();
    expect(() => selfHostInstallCommand("https://u:p@ciele.example.com")).toThrow();
    // Loopback over http is the one exception — that is a local dev server.
    expect(selfHostInstallCommand("http://localhost:3000")).toBe(
      `curl -fsSL http://localhost:3000${INSTALL_SCRIPT_PATH} | sh`
    );
  });
});

describe("normalizeSourceUrl", () => {
  it("keeps a plain repository URL and drops a trailing slash", () => {
    expect(normalizeSourceUrl(`${REPO}/`)).toBe(REPO);
  });

  it("refuses anything that could break out of the shell string", () => {
    for (const hostile of [
      'https://github.com/example/ciele"; rm -rf /; echo "',
      "https://github.com/example/$(whoami)",
      "https://github.com/example/`id`",
      "https://user:token@github.com/example/ciele",
      "http://github.com/example/ciele",
    ]) {
      expect(() => normalizeSourceUrl(hostile)).toThrow();
    }
  });
});

describe("buildSelfHostInstallScript", () => {
  const script = buildSelfHostInstallScript(REPO);

  it("is valid POSIX shell", () => {
    // `sh -n` parses without executing: the cheapest possible guard against
    // shipping a syntax error to everyone who pastes the command.
    expect(() =>
      execFileSync("sh", ["-n"], { input: script, stdio: ["pipe", "pipe", "pipe"] })
    ).not.toThrow();
  });

  it("checks every prerequisite before touching the disk", () => {
    expect(script).toContain("#!/bin/sh");
    expect(script).toContain("set -eu");
    for (const command of BOOTSTRAP_REQUIRED_COMMANDS) {
      expect(script).toContain(command);
    }
    expect(script).toContain("docker compose version");
    expect(script).toContain("MINGW* | MSYS* | CYGWIN*");
  });

  it("fetches the pinned repository, by clone or by tarball", () => {
    expect(script).toContain(`REPO="${REPO}"`);
    expect(script).toContain('git clone --depth 1 "$REPO.git" "$DIR"');
    expect(script).toContain('git clone --depth 1 --branch "$REF" "$REPO.git" "$DIR"');
    expect(script).toContain('tar -xz -C "$DIR" --strip-components=1');
    expect(script).toContain(`\${CIELE_DIR:-${DEFAULT_CHECKOUT_DIR}}`);
  });

  it("hands off to bootstrap.sh by interpreter, forwarding its arguments", () => {
    expect(script).toContain(
      `exec ${BOOTSTRAP_INTERPRETER} ./${BOOTSTRAP_RELATIVE_PATH} "$@"`
    );
  });

  it("never deletes anything and never reads stdin", () => {
    // stdin is the script itself under `curl | sh`, so a prompt would consume
    // it. And an unexpected directory is a refusal, not a cleanup.
    expect(script).not.toMatch(/\brm\s+-[rf]/);
    expect(script).not.toMatch(/^\s*read\s/m);
    expect(script).toContain("is not a Ciele checkout");
  });

  it("refuses to build a script around an unusable source URL", () => {
    expect(() => buildSelfHostInstallScript("javascript:alert(1)")).toThrow();
  });
});

/**
 * The contract with `deploy/bootstrap.sh`. The installer hardcodes facts about
 * that script; these assertions read the real file so a rename, a moved path
 * or a dropped flag fails the build instead of a stranger's terminal.
 */
describe("the bootstrap.sh contract", () => {
  const bootstrap = readFileSync(BOOTSTRAP_PATH, "utf8");

  it("still lives where the installer hands off to it", () => {
    expect(statSync(BOOTSTRAP_PATH).isFile()).toBe(true);
  });

  it("is still interpreted by the shell the installer invokes", () => {
    expect(bootstrap.split("\n")[0]).toContain(BOOTSTRAP_INTERPRETER);
  });

  it("still cannot be piped, which is why the installer clones first", () => {
    // If this ever stops being true, bootstrap.sh has become pipe-safe and this
    // whole module is redundant — that is a deliberate decision, not a silent
    // drift, so it should break here.
    expect(bootstrap).toContain('cd "$(cd "$(dirname "$0")" && pwd)"');
    expect(bootstrap).toContain(".env.example");
  });

  it("still needs everything the installer checks for", () => {
    const proofs: Record<(typeof BOOTSTRAP_REQUIRED_COMMANDS)[number], RegExp> = {
      // The shebang is the bash requirement.
      bash: /^#!.*\bbash\b/,
      openssl: /^need openssl$/m,
      docker: /docker compose version|docker-compose/,
    };
    for (const command of BOOTSTRAP_REQUIRED_COMMANDS) {
      expect(bootstrap).toMatch(proofs[command]);
    }
  });

  it("still parses every flag the installer forwards", () => {
    for (const flag of BOOTSTRAP_FORWARDED_FLAGS) {
      // The argument loop matches each flag as a `case` label, optionally in
      // its `--flag=value` form.
      expect(bootstrap).toMatch(
        new RegExp(`^\\s*(?:--\\w[\\w-]*\\s*\\|\\s*)*\\${flag}(?:=\\*)?\\s*\\)`, "m")
      );
    }
  });
});
