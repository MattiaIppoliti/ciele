import { after } from "next/server";
import {
  teammateChatConnections,
  chatTenantMatches,
} from "@/lib/teammates/chat-connections";
import { teammateChatBot } from "@/lib/teammates/chat-bot";

export const maxDuration = 300;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectionId: string; provider: string }> },
) {
  const { connectionId, provider } = await params;
  const connection = teammateChatConnections().find(
    (entry) => entry.id === connectionId && entry.provider === provider,
  );
  if (!connection) return new Response("Not found", { status: 404 });
  let payload: unknown;
  try {
    payload = await request.clone().json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!chatTenantMatches(connection, payload))
    return new Response("Invalid tenant", { status: 403 });
  try {
    const webhook = teammateChatBot(connection).webhooks[connection.provider];
    if (!webhook)
      return new Response("Connection unavailable", { status: 503 });
    return await webhook(request, {
      waitUntil: (task) => after(() => task),
      propagateHandlerErrors: true,
    });
  } catch {
    return new Response("Connection unavailable", { status: 503 });
  }
}
