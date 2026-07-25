import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONNECTOR_VERSION = "0.3.4";
export const CONNECTOR_FILENAME = `ciele-local-connector-${CONNECTOR_VERSION}.mjs`;
export const CONNECTOR_SHA256 =
  "fb5f15566cf0b96c6fa6d56d34521f9f2c31f85bbf45e8005281f3d1c9290dbb";

export function connectorInstallationScope(
  organizationId: string,
  userId: string
): string {
  return createHash("sha256")
    .update(`${organizationId}\0${userId}`)
    .digest("hex");
}

export function normalizeConnectorOrigin(rawOrigin: string): string {
  const url = new URL(rawOrigin);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && loopbackHosts.has(url.hostname))) ||
    url.username ||
    url.password
  ) {
    throw new Error("Unsupported Ciele origin.");
  }
  return url.origin;
}

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
