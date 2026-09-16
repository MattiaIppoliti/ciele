import { after } from "next/server";
import { getWidgetDb } from "@/lib/widget-db";
import { getRuntimeDb } from "@/lib/runtime-db";
import { isSupabaseServiceConfigured } from "@/lib/supabase/service";
import {
  enqueueSlackMention,
  parseSlackMention,
  verifySlackSignature,
} from "@/lib/slack/events";
import { runSlackMentionJobs } from "@/lib/slack/worker";

export const runtime = "nodejs";
export const maxDuration = 300;

async function boundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256_000) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  const appId = process.env.SLACK_APPLICATION_APP_ID;
  if (!secret || !appId || !isSupabaseServiceConfigured())
    return new Response("Slack bot not configured", { status: 503 });
  if (Number(request.headers.get("content-length")) > 256_000)
    return new Response(null, { status: 413 });
  const body = await boundedBody(request);
  if (body === null) return new Response(null, { status: 413 });
  if (!verifySlackSignature(body, request.headers, secret))
    return new Response("Invalid signature", { status: 401 });
  let payload: Record<string, unknown>;
  try {
    const decoded = JSON.parse(body);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
      throw new Error();
    payload = decoded;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (
    payload.type === "url_verification" &&
    typeof payload.challenge === "string"
  ) {
    return Response.json({ challenge: payload.challenge });
  }
  const mention = parseSlackMention(payload, appId);
  if (!mention) return new Response(null, { status: 200 });
  try {
    const db = getRuntimeDb(getWidgetDb());
    if (await enqueueSlackMention(db, mention)) {
      after(async () => {
        await runSlackMentionJobs({ db });
      });
    }
    return new Response(null, { status: 200 });
  } catch {
    // Do not acknowledge an event that was not persisted (including migration lag).
    return new Response("Slack event temporarily unavailable", { status: 503 });
  }
}
