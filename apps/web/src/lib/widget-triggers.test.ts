import { describe, expect, it } from "vitest";
import {
  chatOpenFiresOnMount,
  readTriggerMessage,
  reportedPageUrl,
} from "./widget-triggers";

describe("chatOpenFiresOnMount", () => {
  it("waits for the floater's signal when the launcher embedded us", () => {
    // widget.js warms the iframe on idle, so mounting is not opening there.
    expect(chatOpenFiresOnMount(new URLSearchParams("launcher=1"))).toBe(false);
  });

  it("treats mounting as opening for an always-visible embed", () => {
    expect(chatOpenFiresOnMount(new URLSearchParams(""))).toBe(true);
    expect(chatOpenFiresOnMount(new URLSearchParams("theme=dark&c=col-1"))).toBe(
      true
    );
  });
});

describe("readTriggerMessage", () => {
  it("reads a reported trigger and the host page URL", () => {
    expect(
      readTriggerMessage({
        type: "ciele:trigger",
        trigger: "page_load",
        url: "https://campus.example/fees",
      })
    ).toEqual({ trigger: "page_load", url: "https://campus.example/fees" });
  });

  it("reads a trigger reported without a URL", () => {
    expect(readTriggerMessage({ type: "ciele:trigger", trigger: "chat_open" })).toEqual(
      { trigger: "chat_open" }
    );
  });

  it("ignores the other traffic on the frame's message bus", () => {
    expect(readTriggerMessage("ciele:close")).toBeNull();
    expect(readTriggerMessage({ type: "ciele:theme", theme: "dark" })).toBeNull();
    expect(readTriggerMessage({ type: "ciele-sso" })).toBeNull();
    expect(readTriggerMessage(null)).toBeNull();
  });

  it("keeps a reported page URL only when it is a real page address", () => {
    expect(reportedPageUrl("https://campus.example/fees?x=1")).toBe(
      "https://campus.example/fees?x=1"
    );
    expect(reportedPageUrl("http://localhost:3000/")).toBe("http://localhost:3000/");
    // It is stored and later displayed in the Inbox, so a script URL is not a page.
    expect(reportedPageUrl("javascript:alert(1)")).toBeUndefined();
    expect(reportedPageUrl("data:text/html,<b>x")).toBeUndefined();
    expect(reportedPageUrl("/fees")).toBeUndefined();
    expect(reportedPageUrl("")).toBeUndefined();
    expect(reportedPageUrl(42)).toBeUndefined();
  });

  it("refuses a trigger name it does not report", () => {
    // "message" is not a client event, and anything else is a tampered payload.
    expect(
      readTriggerMessage({ type: "ciele:trigger", trigger: "message" })
    ).toBeNull();
    expect(
      readTriggerMessage({ type: "ciele:trigger", trigger: "drop_tables" })
    ).toBeNull();
    expect(readTriggerMessage({ type: "ciele:trigger" })).toBeNull();
  });
});
