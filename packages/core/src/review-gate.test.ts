import { describe, expect, it } from "vitest";
import { withReviewBeforeConnectorWrites } from "./review-gate";

/**
 * Human review before a Connector write (#841), as the rule the Flows Agent's
 * drafts pass through rather than a sentence in its persona.
 */
describe("withReviewBeforeConnectorWrites", () => {
  it("puts a Human review in front of a Connector write that has none", () => {
    expect(
      withReviewBeforeConnectorWrites(["api_request", "connector", "custom_message"], {
        connector: { action: "slack.message.post" },
      })
    ).toEqual(["api_request", "human_review", "connector", "custom_message"]);
  });

  it("treats an unchosen Connector action as a write", () => {
    expect(withReviewBeforeConnectorWrites(["connector"], {})).toEqual([
      "human_review",
      "connector",
    ]);
  });

  it("leaves a read alone, and a Flow already gated before the write", () => {
    expect(
      withReviewBeforeConnectorWrites(["connector", "custom_message"], {
        connector: { action: "slack.channel.list" },
      })
    ).toEqual(["connector", "custom_message"]);
    expect(
      withReviewBeforeConnectorWrites(["human_review", "connector"], {
        connector: { action: "slack.message.post" },
      })
    ).toEqual(["human_review", "connector"]);
  });

  it("moves a gate that sits after the write rather than adding a second", () => {
    expect(
      withReviewBeforeConnectorWrites(["connector", "human_review", "custom_message"], {
        connector: { action: "slack.message.post" },
      })
    ).toEqual(["human_review", "connector", "custom_message"]);
  });

  it("does nothing without a Connector", () => {
    expect(withReviewBeforeConnectorWrites(["search_knowledge"], {})).toEqual(["search_knowledge"]);
  });
});
