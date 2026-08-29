import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_CONNECTOR_VERSION } from "./local-connector-protocol";
import { normalizeSafeOrigin } from "./safe-origin";

export const CONNECTOR_FILENAME = `ciele-local-connector-${CURRENT_CONNECTOR_VERSION}.mjs`;
export const CONNECTOR_SHA256 =
  "5972915c8baf85636f9ad5f2ae69b2c3c72c42e4a33133106945b37021074b9a";

export function connectorInstallationScope(
  organizationId: string,
  userId: string
): string {
  return createHash("sha256")
    .update(`${organizationId}\0${userId}`)
    .digest("hex");
}

/**
 * The connector's name for the shared check in `safe-origin.ts`. The rule is
 * not connector-specific, the self-host installer templates an origin into a
 * pasted shell command too, so the implementation lives there and both
 * generators share one hardened validator.
 */
export const normalizeConnectorOrigin = normalizeSafeOrigin;

export function readVerifiedConnectorRuntime(): Buffer {
  const runtime = readFileSync(
    join(process.cwd(), "public", "connectors", CONNECTOR_FILENAME)
  );
  const runtimeDigest = createHash("sha256").update(runtime).digest("hex");
  if (runtimeDigest !== CONNECTOR_SHA256) {
    throw new Error("Connector runtime digest does not match the release.");
  }
  return runtime;
}
