import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_CONNECTOR_VERSION } from "./local-connector-protocol";

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
