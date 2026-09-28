import type { Db } from "@agent-hub/db";
import { getRelayDb, isRelayDbConfigured } from "@/lib/relay-db";

/**
 * Trusted coordination client, the relay's service-role singleton;
 * local/demo deployments keep their existing DB.
 */
export function getRuntimeDb(fallback: Db): Db {
  return isRelayDbConfigured() ? getRelayDb() : fallback;
}
