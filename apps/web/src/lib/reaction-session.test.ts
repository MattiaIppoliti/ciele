import { describe, expect, it, vi } from "vitest";
import { createReactionSession } from "./reaction-session";

const reaction = { organizationId: "o1", messageId: "m1", channelMessageId: null, actorId: "member:u1", actorName: "Ada", emoji: "❤️" };
const response = (reactions: unknown[] = []) => Response.json({ actorId: "member:u1", reactions });

it("a reaction saved after a read starts survives that late read", async () => {
  let finish!: (value: Response) => void;
  const request = vi.fn().mockResolvedValueOnce(response()).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockResolvedValueOnce(response([reaction]));
  const session = createReactionSession("/api/chat/reactions?messageId=m1", request);
  await session.load();
  const reading = session.load();
  expect(await session.toggle("❤️")).toBe(true);
  finish(response());
  await reading;
  expect(session.getSnapshot().reactions).toEqual([reaction]);
});

describe("reaction lifecycle", () => {
  it("a refresh during a write cannot invalidate it or leave saving stuck", async () => {
    let finish!: (value: Response) => void;
    const request = vi.fn().mockResolvedValueOnce(response()).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const session = createReactionSession("/api/chat/reactions?messageId=m1", request);
    await session.load();
    const saving = session.toggle("❤️");
    await session.load();
    expect(request).toHaveBeenCalledTimes(2);
    finish(response([reaction]));
    expect(await saving).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ saving: false, reactions: [reaction] });
  });

  it("ignores a write when its target is detached", async () => {
    let finish!: (value: Response) => void;
    const request = vi.fn().mockResolvedValueOnce(response()).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const session = createReactionSession("/api/chat/reactions?messageId=m1", request);
    await session.load();
    const saving = session.toggle("❤️");
    session.close();
    finish(response([reaction]));
    expect(await saving).toBe(false);
    expect(session.getSnapshot().reactions).toEqual([]);
  });

  it("admits one mutation at a time and derives removal from the verified actor", async () => {
    let finish!: (value: Response) => void;
    const request = vi.fn().mockResolvedValueOnce(response([reaction])).mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const session = createReactionSession("/api/chat/reactions?messageId=m1", request);
    await session.load();
    const saving = session.toggle("❤️");
    expect(await session.toggle("👍")).toBe(false);
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ emoji: "❤️", selected: false });
    finish(response());
    expect(await saving).toBe(true);
  });

  it("rejects malformed receipts and keeps failed writes retryable", async () => {
    const request = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response([{ ...reaction, actorName: null }])).mockResolvedValueOnce(response([reaction]));
    const session = createReactionSession("/api/chat/reactions?messageId=m1", request);
    await session.load();
    expect(await session.toggle("❤️")).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ reactions: [], saving: false, error: "Could not save your reaction. Try again." });
    expect(await session.toggle("❤️")).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ reactions: [reaction], error: null });
  });
});
