import { describe, expect, it, vi } from "vitest";
import { EMPTY_TURN_TRACE, type TurnView } from "@agent-hub/agent/client";
import { patchLastBot, runTurn } from "./turn-session";

type Bot = TurnView & { role: "bot"; id: string | null; feedback: number };
type Msg = { role: "user"; text: string } | { role: "notice"; text: string } | Bot;

const emptyBot = (): Bot => ({
  role: "bot",
  id: null,
  ...EMPTY_TURN_TRACE,
  parts: [],
  streamingText: null,
  feedback: 0,
});

function ndjsonResponse(events: object[], init: ResponseInit = {}): Response {
  const body = events.map((event) => JSON.stringify(event) + "\n").join("");
  return new Response(body, { status: 200, ...init });
}

/** A message list the surface would hold, and the `update` it hands `runTurn`. */
function surface(initial: Msg[]) {
  let messages = initial;
  return {
    get messages() {
      return messages;
    },
    update: (fn: (bot: Bot) => Bot) => {
      messages = patchLastBot(messages, fn);
    },
  };
}

describe("patchLastBot", () => {
  it("patches the newest bot message even when a later row is not a bot", () => {
    const bot = emptyBot();
    const next = patchLastBot([{ role: "user", text: "hi" }, bot, { role: "notice", text: "capped" }], (b) => ({
      ...b,
      id: "m1",
    }));
    expect(next[1]).toMatchObject({ role: "bot", id: "m1" });
    expect(next[2]).toEqual({ role: "notice", text: "capped" });
  });

  it("leaves a list with no bot message unchanged", () => {
    const list: Msg[] = [{ role: "user", text: "hi" }];
    expect(patchLastBot(list, (b) => b)).toBe(list);
  });

  it("never mutates the list it was given", () => {
    const list: Msg[] = [emptyBot()];
    patchLastBot(list, (b) => ({ ...b, id: "m1" }));
    expect((list[0] as Bot).id).toBeNull();
  });
});

describe("runTurn", () => {
  it("streams the reply into the last bot and swaps in the persisted message id", async () => {
    const chat = surface([{ role: "user", text: "hi" }, emptyBot()]);
    const onDone = vi.fn();
    const outcome = await runTurn<Bot>({
      request: () =>
        Promise.resolve(
          ndjsonResponse([
            { type: "turn", conversationId: "c1" },
            { type: "text-delta", delta: "Hello" },
            { type: "text-end" },
            { type: "done", conversationId: "c1", messageId: "m1" },
          ]),
        ),
      update: chat.update,
      onDone,
    });
    expect(outcome).toEqual({ status: "done" });
    expect(chat.messages[1]).toMatchObject({ role: "bot", id: "m1" });
    expect(onDone).toHaveBeenCalledWith({ conversationId: "c1", messageId: "m1" });
  });

  it("sends a fresh turn id with every request", async () => {
    const ids: string[] = [];
    const request = (_signal: AbortSignal | undefined, turnId: string) => {
      ids.push(turnId);
      return Promise.resolve(ndjsonResponse([{ type: "done", conversationId: "c1", messageId: null }]));
    };
    await runTurn<Bot>({ request, update: () => {} });
    await runTurn<Bot>({ request, update: () => {} });
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("reports a non-OK response as a failure carrying the surface's message", async () => {
    const outcome = await runTurn<Bot>({
      request: () => Promise.resolve(new Response("nope", { status: 403 })),
      update: () => {},
      failure: (status) => (status === 403 ? "Only editors can do this" : `Chat failed (${status})`),
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.status === "failed" && outcome.error.message).toBe("Only editors can do this");
  });

  it("uses a default failure message when the surface gives none", async () => {
    const outcome = await runTurn<Bot>({
      request: () => Promise.resolve(new Response(null, { status: 500 })),
      update: () => {},
    });
    expect(outcome.status === "failed" && outcome.error.message).toBe("Chat failed (500)");
  });

  it("reports an aborted request as aborted, not as a failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await runTurn<Bot>({
      signal: controller.signal,
      request: (signal) => fetchThatHonours(signal),
      update: () => {},
    });
    expect(outcome).toEqual({ status: "aborted" });
  });

  it("reports a network error as a failure", async () => {
    const outcome = await runTurn<Bot>({
      request: () => Promise.reject(new TypeError("Failed to fetch")),
      update: () => {},
    });
    expect(outcome.status === "failed" && outcome.error.message).toBe("Failed to fetch");
  });

  it("passes every raw event to onEvent and the start to onStart", async () => {
    const seen: string[] = [];
    const onStart = vi.fn();
    await runTurn<Bot>({
      request: () =>
        Promise.resolve(
          ndjsonResponse([
            { type: "turn", conversationId: "c9" },
            { type: "done", conversationId: "c9", messageId: "m9" },
          ]),
        ),
      update: () => {},
      onStart,
      onEvent: (event) => seen.push(event.type),
    });
    expect(onStart).toHaveBeenCalledWith({ conversationId: "c9" });
    expect(seen).toEqual(["turn", "done"]);
  });
});

/** A request that rejects the way fetch does when its signal is aborted. */
function fetchThatHonours(signal: AbortSignal | undefined): Promise<Response> {
  if (signal?.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  return Promise.resolve(ndjsonResponse([]));
}
