import { describe, expect, it } from "vitest";
import {
  APPLICATION_CONNECTED_MESSAGE,
  isApplicationConnectedMessage,
} from "./application-connected";

const ORIGIN = "https://ciele.app";

describe("isApplicationConnectedMessage", () => {
  it("accepts the callback page's own message from the same origin", () => {
    expect(
      isApplicationConnectedMessage(
        { origin: ORIGIN, data: { type: APPLICATION_CONNECTED_MESSAGE, provider: "slack" } },
        ORIGIN
      )
    ).toBe(true);
  });

  it("ignores another origin, another type, and data that is not an object", () => {
    const data = { type: APPLICATION_CONNECTED_MESSAGE, provider: "slack" };
    expect(isApplicationConnectedMessage({ origin: "https://evil.example", data }, ORIGIN)).toBe(
      false
    );
    expect(
      isApplicationConnectedMessage({ origin: ORIGIN, data: { type: "ciele:other" } }, ORIGIN)
    ).toBe(false);
    expect(isApplicationConnectedMessage({ origin: ORIGIN, data: "connected" }, ORIGIN)).toBe(
      false
    );
    expect(isApplicationConnectedMessage({ origin: ORIGIN, data: null }, ORIGIN)).toBe(false);
  });
});
