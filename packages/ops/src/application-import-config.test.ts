import { describe, expect, it } from "vitest";
import { normalizeApplicationImportConfig } from "./application-import-config";

describe("Application Import scope validation", () => {
  it("requires an accessible Slack channel and defaults to 180 days", () => {
    expect(() =>
      normalizeApplicationImportConfig("slack", { channelIds: [] })
    ).toThrow("Select at least one Slack channel");
    expect(
      normalizeApplicationImportConfig("slack", { channelIds: ["C01"] })
    ).toEqual({ channelIds: ["C01"], historyDays: 180, allHistory: false });
  });

  it("requires a selected ServiceNow knowledge base", () => {
    expect(() =>
      normalizeApplicationImportConfig("servicenow", {
        knowledgeBaseIds: [],
      })
    ).toThrow("Select at least one ServiceNow knowledge base");
  });

  it("requires an explicit cloud-drive scope", () => {
    expect(() => normalizeApplicationImportConfig("onedrive", {})).toThrow(
      "Select a drive or folder"
    );
    expect(
      normalizeApplicationImportConfig("google_drive", {
        scopeId: "drive:my_drive",
        driveId: "",
      })
    ).toMatchObject({ scopeId: "drive:my_drive" });
  });

  it("enforces Salesforce's category-group limit", () => {
    expect(() =>
      normalizeApplicationImportConfig("salesforce", {
        dataCategories: ["category:Audience:Student", "category:Audience:Staff"],
      })
    ).toThrow("different groups");
  });
});
