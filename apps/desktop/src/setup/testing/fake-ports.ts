// Scripted stand-ins for everything the setup engine touches.
//
// Two jobs, deliberately the same code for both:
//   - the engine's unit tests, which is where the breadth lives;
//   - `--fake-ports`, which is how the packaged app is smoke-tested on a CI
//     runner with no Docker Desktop, and how a contributor sees the whole
//     wizard on a machine that cannot run the stack.
//
// One implementation means the flow the smoke drives is the flow the tests
// describe. The randomness is seeded and the clock is fixed so a failing test
// says the same thing twice.

import { createHmac } from "node:crypto";
import type { SetupPorts } from "../ports";

export interface FakePortOptions {
  dockerInstalled?: boolean;
  dockerRunning?: boolean;
  /**
   * Compose subcommands that fail their first attempt and succeed after.
   * Match is a substring of the joined arguments, e.g. "pull".
   *
   * This is how the smoke exercises the failure-and-retry path, which is the
   * part of the wizard a user is most likely to meet and least likely to
   * forgive being wrong.
   */
  failOnce?: readonly string[];
  /** Files that already exist, e.g. a `.env` from a previous run. */
  files?: Record<string, string>;
  /** Milliseconds each compose call takes, so progress is visible. */
  latencyMs?: number;
}

export interface FakePorts extends SetupPorts {
  /** The in-memory filesystem, for assertions. */
  files: Map<string, string>;
  /** Every compose invocation, joined, in order. */
  composeCalls: string[];
}

export function fakePorts(options: FakePortOptions = {}): FakePorts {
  const {
    dockerInstalled = true,
    dockerRunning = true,
    failOnce = [],
    latencyMs = 0,
  } = options;

  const files = new Map<string, string>(Object.entries(options.files ?? {}));
  const dirs = new Set<string>();
  const composeCalls: string[] = [];
  const failed = new Set<string>();
  let seed = 1;
  let stackUp = false;
  let seeded = false;

  const sleep = (ms: number) =>
    ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

  return {
    files,
    composeCalls,

    docker: {
      locate: async () => (dockerInstalled ? "/usr/local/bin/docker" : null),
      isRunning: async () => dockerInstalled && dockerRunning,
      async compose(args, onOutput) {
        const joined = args.join(" ");
        composeCalls.push(joined);
        onOutput?.(`$ docker compose ${joined}\n`);
        await sleep(latencyMs);

        const trigger = failOnce.find((needle) => joined.includes(needle));
        if (trigger && !failed.has(trigger)) {
          failed.add(trigger);
          onOutput?.("Error: simulated failure\n");
          return { code: 1, output: `$ docker compose ${joined}\nError: simulated failure\n` };
        }
        if (args.includes("up")) stackUp = true;
        if (args.includes("stop") || args.includes("down")) stackUp = false;
        if (joined.includes("LOAD_DEMO_SEED=1")) seeded = true;

        // `ps --quiet` is the one subcommand whose *output* is read rather
        // than its exit code — it lists container ids, and nothing when there
        // are none. A fake that echoed a banner here would make "stopped"
        // unreachable.
        if (args.includes("ps") && args.includes("--quiet")) {
          return { code: 0, output: stackUp ? "fake-container-id\n" : "" };
        }

        // The other output-read subcommand: the seed verify counts rows via
        // psql. A fake that echoed its banner here would make every count
        // unparseable, and one that always said 3 would make "did not load"
        // unreachable.
        if (args.includes("psql")) {
          return { code: 0, output: seeded ? "3\n" : "0\n" };
        }

        onOutput?.("done\n");
        return { code: 0, output: `$ docker compose ${joined}\ndone\n` };
      },
    },

    fs: {
      ensureDir: async (path) => void dirs.add(path),
      readFile: async (path) => files.get(path) ?? null,
      writeFile: async (path, contents) => void files.set(path, contents),
      exists: async (path) => files.has(path) || dirs.has(path),
    },

    probe: {
      // Reachable once the stack has been started, and only then: a probe
      // that always answers would make the health step meaningless.
      get: async (url) => (stackUp ? { status: 200, body: `fake response for ${url}` } : null),
    },

    crypto: {
      // A linear congruential generator: reproducible, and obviously not
      // suitable for anything but a fake.
      randomBytes(count) {
        const out = new Uint8Array(count);
        for (let i = 0; i < count; i++) {
          seed = (seed * 1103515245 + 12345) % 2147483648;
          out[i] = seed % 256;
        }
        return out;
      },
      // Real HMAC on purpose: the JWTs the secret step mints are checked by
      // verifying their signature, and a fake signature would make that test
      // agree with itself.
      hmacSha256: (key, message) =>
        new Uint8Array(createHmac("sha256", key).update(message).digest()),
    },

    clock: {
      nowSeconds: () => 1_800_000_000,
    },
  };
}
