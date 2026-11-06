import type { OutboundWebhookInput, OutboundWebhookPatch } from "@ciele/client";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { confirmed, jsonFile, usage, type CommandContext } from "./shared.ts";

export async function webhooks(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, flags, emit, deps } = ctx;
  if (verb !== "list" && verb !== "deliveries" && verb !== "create" && (!rest[0] || !confirmed(flags))) return usage(deps, "webhooks <update|pause|resume|delete|test> <id> --yes");
  switch (verb) {
  case "list": {
    const result = await client.webhooks.list();
    emit(table(result.data, [{ key: "id", header: "ID" }, { key: "name", header: "Name" }, { key: "url", header: "URL" }, { key: "paused", header: "Paused" }]), result);
    return EXIT.ok;
  }
  case "deliveries": {
    if (!rest[0]) return usage(deps, "webhooks deliveries <id>");
    const result = await client.webhooks.deliveries(rest[0]);
    emit(table(result.data.map((delivery) => ({ ...delivery, eventType: delivery.event.type })), [{ key: "id", header: "ID" }, { key: "eventType", header: "Event" }, { key: "attempts", header: "Attempts" }, { key: "lastStatusCode", header: "HTTP" }, { key: "lastAttemptAt", header: "Time" }]), result);
    return EXIT.ok;
  }
  case "create": {
    if (!confirmed(flags)) return usage(deps, "webhooks create --file <webhook.json> --yes");
    const input = jsonFile<OutboundWebhookInput>(ctx, "webhooks create --file <webhook.json> --yes");
    if (input === undefined) return EXIT.usage;
    const result = await client.webhooks.create(input);
    emit(`Created ${result.subscription.id}. Save this signing secret; it is shown once:\n${result.secret}`, result);
    return EXIT.ok;
  }
    case "update": {
      const patch = jsonFile<OutboundWebhookPatch>(ctx, "webhooks update <id> --file <patch.json> --yes");
      if (patch === undefined) return EXIT.usage;
      const result = await client.webhooks.update(rest[0], patch);
      emit(`Updated ${result.id}`, result);
      return EXIT.ok;
    }
    case "pause":
    case "resume": {
      const result = await client.webhooks.update(rest[0], { paused: verb === "pause" });
      emit(`${result.paused ? "Paused" : "Resumed"} ${result.id}`, result);
      return EXIT.ok;
    }
    case "delete":
      await client.webhooks.delete(rest[0]);
      emit(`Deleted ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    case "test": {
      const result = await client.webhooks.test(rest[0]);
      emit(`Queued test event ${result.eventId}`, result);
      return EXIT.ok;
    }
    default: return usage(deps, "webhooks <list|create|update|pause|resume|delete|deliveries|test>");
  }
}
