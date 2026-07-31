import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONNECTOR_VERSION = "0.3.5";
export const CONNECTOR_FILENAME = `ciele-local-connector-${CONNECTOR_VERSION}.mjs`;
export const CONNECTOR_SHA256 =
  "00a330c7a5353679de4bdac0908f6ce87e01b131049b00f51fcf15db13c67235";

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
