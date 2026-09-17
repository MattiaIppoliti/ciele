import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSlackMention, verifySlackSignature } from "./events";

const mention = {
  eventId: "EvTEST",
  teamId: "TTEST",
  appId: "ATEST",
  channel: "CTEST",
  user: "UTEST",
  text: "<@UBOT> hello",
  ts: "1770000002.000001",
};

describe("Slack event boundary", () => {
  it("authenticates the raw body and rejects tampering, stale timestamps and malformed signatures", () => {
    const body = '{"challenge":"challenge"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = new Headers({
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": `v0=${createHmac("sha256", "secret").update(`v0:${timestamp}:${body}`).digest("hex")}`,
    });
    expect(verifySlackSignature(body, headers, "secret")).toBe(true);
    expect(verifySlackSignature(body + " ", headers, "secret")).toBe(false);
    expect(
      verifySlackSignature(body, headers, "secret", Date.now() + 301000),
    ).toBe(false);
    headers.set("x-slack-signature", "v0=bad");
    expect(verifySlackSignature(body, headers, "secret")).toBe(false);
  });

  it("accepts mentions only for this app, excluding bots, DMs and shared channels", () => {
    const body = {
      type: "event_callback",
      api_app_id: mention.appId,
      team_id: mention.teamId,
      event_id: mention.eventId,
      event: {
        type: "app_mention",
        channel: mention.channel,
        user: mention.user,
        text: mention.text,
        ts: mention.ts,
      },
    };
    expect(parseSlackMention(body, mention.appId)?.threadTs).toBe(mention.ts);
    expect(parseSlackMention(body, "AOTHER")).toBeNull();
    expect(
      parseSlackMention(
        { ...body, is_ext_shared_channel: true },
        mention.appId,
      ),
    ).toBeNull();
    for (const patch of [
      { bot_id: "BBOT" },
      { channel: "DTEST" },
      { subtype: "message_changed" },
    ]) {
      expect(
        parseSlackMention(
          { ...body, event: { ...body.event, ...patch } },
          mention.appId,
        ),
      ).toBeNull();
    }
  });
});
