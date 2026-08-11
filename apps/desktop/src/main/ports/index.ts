// The real implementations of the setup engine's ports.
//
// Each is as thin as it can be: the decisions live in the engine, where they
// are tested. What is here is the part that genuinely cannot be — talking to
// Docker, the disk, the network and the platform's crypto.

import { createHmac, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { createDockerPort } from "./docker";
import type { SetupConfig, SetupPorts } from "../../setup/ports";

/** How long a health probe waits before calling the stack unreachable. */
const PROBE_TIMEOUT_MS = 5_000;

export function createRealPorts(config: SetupConfig): SetupPorts {
  return {
    docker: createDockerPort({ cwd: config.deployDir }),

    fs: {
      ensureDir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => undefined),
      // Absence is an answer, not a failure: "is there already an install
      // here?" is the question every caller is actually asking.
      readFile: (file) => fs.readFile(file, "utf8").catch(() => null),
      writeFile: (file, contents, options) =>
        fs.writeFile(file, contents, { encoding: "utf8", mode: options?.mode }),
      exists: (target) =>
        fs
          .access(target)
          .then(() => true)
          .catch(() => false),
    },

    probe: {
      async get(url, timeoutMs = PROBE_TIMEOUT_MS) {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
          // Only the first slice: a health check reads a status, and the app's
          // home page would otherwise pull a megabyte of HTML into memory for
          // nothing.
          const body = (await response.text()).slice(0, 2_000);
          return { status: response.status, body };
        } catch {
          // Unreachable and "answered badly" are different things, and the
          // steps tell the user different things about them.
          return null;
        }
      },
    },

    crypto: {
      randomBytes: (count) => new Uint8Array(randomBytes(count)),
      hmacSha256: (key, message) =>
        new Uint8Array(createHmac("sha256", key).update(message).digest()),
    },

    clock: { nowSeconds: () => Math.floor(Date.now() / 1000) },
  };
}
