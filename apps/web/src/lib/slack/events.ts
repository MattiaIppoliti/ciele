import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "@agent-hub/db";
import { slackBotConfig } from "./config";

export interface SlackMention {
  eventId: string;
  teamId: string;
  appId: string;
  channel: string;
  user: string;
  text: string;
  ts: string;
  threadTs: string;
}

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

export function slackKey(...parts: string[]): string {
  return `slack_${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

/** A workspace/channel can resolve to one Organization only. Ambiguity fails closed. */
export async function resolveSlackConnection(db: Db, mention: SlackMention) {
  const candidates = (
    await db.listSlackWorkspaceConnections(mention.teamId)
  ).filter((connection) => {
    const config = slackBotConfig(connection.metadata);
    return (
      connection.status === "connected" &&
      connection.ownerType === "organization" &&
      connection.metadata.slackAppId === mention.appId &&
      config?.channelIds.includes(mention.channel)
    );
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export async function enqueueSlackMention(
  db: Db,
  mention: SlackMention,
): Promise<boolean> {
  const connection = await resolveSlackConnection(db, mention);
  if (!connection) return false;
  const config = slackBotConfig(connection.metadata)!;
  await db.createBackgroundJob({
    id: slackKey(mention.appId, mention.eventId),
    organizationId: connection.organizationId,
    kind: "answer_slack_mention",
    payload: {
      mention,
      connectionId: connection.id,
      assistantId: config.assistantId,
    },
    maxAttempts: 3,
  });
  return true;
}
