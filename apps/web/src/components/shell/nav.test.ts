import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assistantIdFromPath,
  assistantSectionFromPath,
  legacyAssistantSectionHref,
  setupHref,
  SETUP_SECTIONS,
} from "./nav";

const ASSISTANT_ROUTE = fileURLToPath(
  new URL("../../app/(admin)/assistants/[id]/", import.meta.url),
);

describe("Assistant navigation", () => {
  it("has a destination-owned loading boundary for every enabled SETUP section", () => {
    const enabled = SETUP_SECTIONS.filter((section) => section.enabled);
    const loadingPath = (slug: string) =>
      `${ASSISTANT_ROUTE}${slug}/loading.tsx`;
    const missing = enabled
      .filter((section) => !existsSync(loadingPath(section.slug)))
      .map((section) => section.slug);

    expect(missing).toEqual([]);
    for (const section of enabled) {
      expect(readFileSync(loadingPath(section.slug), "utf8")).toContain(
        `variant="${section.slug}"`,
      );
    }
  });

  it("reads the Assistant and top-level section from nested routes", () => {
    expect(assistantIdFromPath("/assistants/asst-1/flows/flow-2")).toBe("asst-1");
    expect(assistantSectionFromPath("/assistants/asst-1/flows/flow-2")).toBe(
      "flows"
    );
    expect(assistantSectionFromPath("/assistants/asst-1")).toBeNull();
  });

  it("builds canonical SETUP routes", () => {
    expect(setupHref("asst-1", "knowledge")).toBe(
      "/assistants/asst-1/knowledge"
    );
    expect(setupHref(null, "knowledge")).toBe("/setup/knowledge");
  });

  it("keeps former query-param URLs compatible", () => {
    expect(
      legacyAssistantSectionHref("asst-1", { page: "general" })
    ).toBe("/assistants/asst-1/general");
    expect(
      legacyAssistantSectionHref("asst-1", {
        page: "knowledge",
        c: "collection / one",
      })
    ).toBe("/assistants/asst-1/knowledge?c=collection%20%2F%20one");
    expect(
      legacyAssistantSectionHref("asst-1", {
        page: "flows",
        flowId: "flow / one",
      })
    ).toBe("/assistants/asst-1/flows/flow%20%2F%20one");
  });

  it("keeps overview canonical and rejects unknown sections", () => {
    expect(legacyAssistantSectionHref("asst-1", {})).toBeNull();
    expect(
      legacyAssistantSectionHref("asst-1", { page: "overview" })
    ).toBeNull();
    expect(
      legacyAssistantSectionHref("asst-1", { page: "unknown" })
    ).toBe("/assistants/asst-1");
  });
});
