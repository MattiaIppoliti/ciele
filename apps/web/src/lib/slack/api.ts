export class SlackApiError extends Error {
  constructor(
    public code: string,
    public retryAfter = 0,
    public method?: string,
    public detail?: string,
  ) {
    super(
      `Slack ${method ?? "API"}: ${code}${detail ? ` (${detail})` : ""}`,
    );
  }
}

type SlackMethod =
  | "conversations.info"
  | "conversations.history"
  | "conversations.replies"
  | "chat.postMessage";

function slackErrorDetail(result: Record<string, unknown>): string | undefined {
  const metadata = result.response_metadata as
    | { messages?: unknown }
    | undefined;
  if (!Array.isArray(metadata?.messages)) return undefined;
  const messages = metadata.messages
    .filter((message): message is string => typeof message === "string")
    .map((message) => message.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return messages.length ? messages.join("; ").slice(0, 500) : undefined;
}

/** Fixed provider origin, bounded requests, no credentials in error messages. */
export async function slackApi(
  token: string,
  method: SlackMethod,
  parameters: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  // Slack documents JSON payloads for write methods. Its conversations read
  // methods expect ordinary Web API form parameters and can otherwise answer
  // with `invalid_arguments` even when the channel ID itself is valid.
  const json = method === "chat.postMessage";
  const body = json
    ? JSON.stringify(parameters)
    : new URLSearchParams(
        Object.entries(parameters).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, String(value)]],
        ),
      ).toString();
  const response = await fetcher(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": json
        ? "application/json; charset=utf-8"
        : "application/x-www-form-urlencoded; charset=utf-8",
    },
    body,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 429) {
    throw new SlackApiError(
      "ratelimited",
      Math.max(1, Number(response.headers.get("retry-after")) || 60),
      method,
    );
  }
  if (!response.ok)
    throw new SlackApiError(`http_${response.status}`, 0, method);
  const result = (await response.json()) as Record<string, unknown>;
  if (result.ok !== true)
    throw new SlackApiError(
      typeof result.error === "string" ? result.error : "invalid_response",
      0,
      method,
      slackErrorDetail(result),
    );
  return result;
}
