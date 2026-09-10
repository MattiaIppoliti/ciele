import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

/**
 * `ciele reviews …` (#841): the Human review gate's requests. Listing is any
 * key; deciding needs an Owner/Admin key, because a key has no email to match
 * an assignee with (the operation says so when it refuses).
 */
export async function reviews(verb: string | undefined, ctx: CommandContext): Promise<number> {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const { data } = await client.reviews.list({
        status: str(flags.status),
        conversationId: str(flags.conversation),
        assistantId: str(flags.assistant),
      });
      emit(
        table(
          data.map((row) => ({
            id: row.id,
            status: row.status,
            title: row.title,
            conversation: row.conversationId,
            decidedBy: row.decidedByName ?? "",
            expires: row.expiresAt,
          })),
          [
            { key: "id", header: "ID" },
            { key: "status", header: "Status" },
            { key: "title", header: "Title" },
            { key: "conversation", header: "Conversation" },
            { key: "decidedBy", header: "Decided by" },
            { key: "expires", header: "Expires" },
          ]
        ),
        data
      );
      return EXIT.ok;
    }
    case "get": {
      const id = rest[0];
      if (!id) return usage(deps, "reviews get <reviewId>");
      const review = await client.reviews.get(id);
      emit(JSON.stringify(review, null, 2), review);
      return EXIT.ok;
    }
    case "decide": {
      const id = rest[0];
      const decision = str(flags.decision);
      if (!id || (decision !== "approved" && decision !== "rejected")) {
        return usage(deps, "reviews decide <reviewId> --decision approved|rejected [--inputs key=value,key=value]");
      }
      const inputs: Record<string, string> = {};
      for (const pair of (str(flags.inputs) ?? "").split(",")) {
        const eq = pair.indexOf("=");
        if (eq > 0) inputs[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      }
      const review = await client.reviews.decide(id, { decision, inputs });
      emit(`${review.status}${review.decidedByName ? ` by ${review.decidedByName}` : ""}`, review);
      return EXIT.ok;
    }
    default:
      return usage(deps, "reviews list|get|decide");
  }
}
