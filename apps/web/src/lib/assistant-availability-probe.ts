import type {
  AssistantAvailabilityCheck,
  AssistantAvailabilityTarget,
} from "@agent-hub/core";

/** Fixed deployment origin supplied by server configuration; never a request header. */
export async function probeAssistantAvailability(
  target: AssistantAvailabilityTarget,
  origin: string,
  fetcher: typeof fetch = fetch,
): Promise<AssistantAvailabilityCheck> {
  const started = Date.now();
  const result: AssistantAvailabilityCheck = {
    assistantId: target.id,
    organizationId: target.organizationId,
    checkedAt: new Date(started).toISOString(),
    status: "down",
    latencyMs: 0,
    issue: null,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = new URL(
      `/api/widget/${encodeURIComponent(target.id)}/config`,
      origin,
    );
    url.searchParams.set("availability_check", String(started));
    const response = await fetcher(url, {
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      result.issue = "http_error";
    } else {
      // Bound the response as well as the request: an HTML interstitial is not a valid config.
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!reader) result.issue = "invalid_config";
      else {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1024 * 1024) {
            await reader.cancel();
            result.issue = "invalid_config";
            break;
          }
          chunks.push(value);
        }
        if (!result.issue) {
          const buffer = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.length;
          }
          let config: unknown;
          try {
            config = JSON.parse(new TextDecoder().decode(buffer));
          } catch {
            result.issue = "invalid_config";
          }
          if (
            typeof config === "object" &&
            config !== null &&
            "version" in config &&
            Number.isInteger(config.version) &&
            "nickname" in config &&
            typeof config.nickname === "string" &&
            "collections" in config &&
            Array.isArray(config.collections) &&
            "style" in config &&
            typeof config.style === "object" &&
            config.style !== null
          ) {
            result.status = Date.now() - started > 2000 ? "degraded" : "up";
            result.issue =
              result.status === "degraded" ? "slow_response" : null;
          } else result.issue = "invalid_config";
        }
      }
    }
  } catch {
    result.issue = controller.signal.aborted ? "timeout" : "network_error";
  } finally {
    clearTimeout(timeout);
    result.latencyMs = Math.max(0, Date.now() - started);
  }
  return result;
}
