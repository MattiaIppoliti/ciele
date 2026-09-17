import { createHmac, timingSafeEqual } from "node:crypto";
import type { SlackMention } from "@agent-hub/agent";

export function verifySlackSignature(
  body: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
): boolean {
  const timestamp = headers.get("x-slack-request-timestamp") ?? "";
  const signature = headers.get("x-slack-signature") ?? "";
  if (
    !secret ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^v0=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function parseSlackMention(
  body: Record<string, unknown>,
  appId: string,
): SlackMention | null {
  if (
    body.type !== "event_callback" ||
    body.api_app_id !== appId ||
    !appId ||
    body.is_ext_shared_channel === true
  )
    return null;
  const event = body.event as Record<string, unknown> | undefined;
  if (
    !event ||
    event.type !== "app_mention" ||
    event.bot_id ||
    event.subtype ||
    event.hidden ||
    event.is_ext_shared_channel === true
  )
    return null;
  const valid = (v: unknown, re: RegExp): v is string =>
    typeof v === "string" && re.test(v);
  if (
    !valid(body.event_id, /^Ev[A-Za-z0-9]+$/) ||
    !valid(body.team_id, /^T[A-Z0-9]+$/) ||
    !valid(event.channel, /^[CG][A-Z0-9]+$/) ||
    !valid(event.user, /^[UW][A-Z0-9]+$/) ||
    !valid(event.ts, /^\d{10,}\.\d+$/) ||
    typeof event.text !== "string" ||
    event.text.length > 40_000 ||
    (event.thread_ts !== undefined && !valid(event.thread_ts, /^\d{10,}\.\d+$/))
  )
    return null;
  return {
    eventId: body.event_id,
    teamId: body.team_id,
    appId,
    channel: event.channel,
    user: event.user,
    text: event.text,
    ts: event.ts,
    threadTs: (event.thread_ts as string | undefined) ?? event.ts,
  };
}
