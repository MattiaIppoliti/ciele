import { describe, expect, it } from "vitest";
import type { ChatReplyPart } from "@/lib/runtime/client";
import { latestHelpDeskId, visibleReplyParts } from "./visible-reply-parts";

describe("visibleReplyParts", () => {
  it("omits inline help-desk actions while preserving the rest of the response", () => {
    const parts: ChatReplyPart[] = [
      { type: "text", action: "search_knowledge", text: "The answer." },
      {
        type: "help_desk",
        action: "suggest_help_desk",
        label: "Contact support",
        helpDeskId: "desk-1",
      },
      {
        type: "sources",
        action: "search_knowledge",
        sources: [
          {
            conceptTitle: "Getting started",
            collectionName: "Ciele Docs",
            sourceName: "Getting started",
            url: "https://example.com/getting-started",
          },
        ],
      },
      {
        type: "help_desk",
        action: "show_button",
        label: "Contact admissions",
        helpDeskId: "desk-admissions",
      },
    ];

    expect(visibleReplyParts(parts, true)).toEqual([parts[0], parts[2], parts[3]]);
  });

  it("keeps the automatic support action when the persistent button is hidden", () => {
    const supportPart: ChatReplyPart = {
      type: "help_desk",
      action: "suggest_help_desk",
      label: "Contact support",
    };

    expect(visibleReplyParts([supportPart], false)).toEqual([supportPart]);
  });

  it("keeps the latest AI-recommended desk available to the persistent support button", () => {
    const earlier: ChatReplyPart[] = [
      {
        type: "help_desk",
        action: "suggest_help_desk",
        label: "Contact support",
        helpDeskId: "desk-general",
      },
    ];
    const latest: ChatReplyPart[] = [
      { type: "text", action: "search_knowledge", text: "Admissions can help." },
      {
        type: "help_desk",
        action: "suggest_help_desk",
        label: "Contact admissions",
        helpDeskId: "desk-admissions",
      },
      {
        type: "help_desk",
        action: "show_button",
        label: "Open a configured desk",
        helpDeskId: "desk-configured-button",
      },
    ];

    expect(latestHelpDeskId([earlier, latest])).toBe("desk-admissions");
  });
});
