import { describe, expect, it } from "vitest";
import type { ApplicationConnection } from "./types";
import {
  CONNECTOR_ACTIONS,
  CONNECTOR_PROVIDERS,
  connectorAction,
  connectorActionsFor,
  connectorConnectionIssue,
  connectorMissingParams,
  connectorMissingScopes,
  connectorParamValue,
  connectorRunsInternalOnly,
  connectorSettingsIssue,
  isConnectorProvider,
  CONNECTOR_INTERNAL_ONLY_REASON,
} from "./connector-catalog";

/**
 * The catalogue is data the builder, Publish and the runtime all read (#839).
 * These tests pin its shape: every key well-formed and unique, every dynamic
 * dependency naming a real field, every default a member of its options, and
 * the two judgement functions the other layers rely on.
 */

const connection = (over: Partial<ApplicationConnection> = {}): ApplicationConnection => ({
  id: "c1",
  organizationId: "o1",
  ownerType: "organization",
  ownerMemberId: null,
  provider: "slack",
  name: "Slack",
  status: "connected",
  sealedCredentials: "",
  scopes: ["channels:read", "chat:write"],
  providerAccountId: null,
  metadata: {},
  error: "",
  lastConnectedAt: null,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  ...over,
});

describe("the Connector catalogue", () => {
  it("covers the three providers with the observed actions and nothing else", () => {
    expect(CONNECTOR_PROVIDERS).toEqual([
      "servicenow",
      "salesforce",
      "slack",
      "onedrive",
      "google_drive",
    ]);
    for (const provider of ["onedrive", "google_drive"] as const) {
      expect(connectorActionsFor(provider).map((a) => a.key.split(".").slice(1).join("."))).toEqual([
        "file.create",
        "file.copy",
        "file.find",
        "file.get_content",
        "file.get_metadata",
        "file.share_link",
        "file.delete",
      ]);
      expect(connectorRunsInternalOnly(provider)).toBe(true);
    }
    expect(connectorRunsInternalOnly("slack")).toBe(false);
    expect(connectorActionsFor("servicenow").map((a) => a.key)).toEqual([
      "servicenow.record.create",
      "servicenow.record.update",
      "servicenow.record.list",
      "servicenow.record.delete",
    ]);
    expect(connectorActionsFor("salesforce").map((a) => a.key)).toEqual([
      "salesforce.contact.get",
      "salesforce.case.get",
      "salesforce.user.get",
      "salesforce.product.get",
    ]);
    expect(connectorActionsFor("slack").map((a) => a.key)).toEqual([
      "slack.message.post",
      "slack.channel.create",
      "slack.channel.join",
      "slack.channel.list",
    ]);
    expect(CONNECTOR_ACTIONS.some((a) => /dnd|disturb/i.test(a.key + a.title))).toBe(false);
  });

  it("keys are `<provider>.<noun>.<verb>`, unique, and start with their provider", () => {
    const keys = CONNECTOR_ACTIONS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const action of CONNECTOR_ACTIONS) {
      expect(action.key).toMatch(/^[a-z_]+\.[a-z_]+\.[a-z_]+$/);
      expect(action.key.startsWith(`${action.provider}.`)).toBe(true);
      expect(isConnectorProvider(action.provider)).toBe(true);
    }
  });

  it("every dynamic dependency names a field of the same action, defaults belong to options", () => {
    for (const action of CONNECTOR_ACTIONS) {
      const names = new Set(action.fields.map((f) => f.name));
      expect(names.size).toBe(action.fields.length);
      for (const field of action.fields) {
        if (field.dynamic?.dependsOn) expect(names.has(field.dynamic.dependsOn)).toBe(true);
        if (field.type === "options") {
          expect(field.options?.length).toBeGreaterThan(0);
          if (field.defaultValue !== undefined) {
            expect(field.options!.map((o) => o.value)).toContain(field.defaultValue);
          }
        }
        if (field.dynamic && field.type !== "string" && field.type !== "json") {
          throw new Error(`${action.key}.${field.name}: dynamic fields stay free-text`);
        }
      }
      expect(action.outputs.length).toBeGreaterThan(0);
    }
  });

  it("looks actions up by key and refuses unknown ones", () => {
    expect(connectorAction("slack.message.post")?.effect).toBe("write");
    expect(connectorAction("slack.message.delete")).toBeNull();
    expect(connectorAction(undefined)).toBeNull();
  });

  it("names the scopes a connection lacks, and nothing for coarse grants", () => {
    const post = connectorAction("slack.message.post")!;
    expect(connectorMissingScopes(post, ["channels:read"])).toEqual(["chat:write"]);
    expect(connectorMissingScopes(post, ["channels:read", "chat:write"])).toEqual([]);
    const create = connectorAction("servicenow.record.create")!;
    expect(connectorMissingScopes(create, ["useraccount"])).toEqual([]);
  });

  it("judges required params, honouring defaults", () => {
    const post = connectorAction("slack.message.post")!;
    expect(connectorMissingParams(post, {})).toEqual(["channel"]);
    expect(connectorMissingParams(post, { channel: "C1" })).toEqual([]);
    expect(connectorParamValue(post, {}, "text")).toMatch(/workflow\.message/);
    expect(connectorParamValue(post, { text: "hi" }, "text")).toBe("hi");
  });

  it("settings issue: action → connection → required fields, in that order", () => {
    expect(connectorSettingsIssue(undefined)).toBe("Choose a connector action");
    expect(connectorSettingsIssue({ action: "slack.message.post" })).toBe("Choose a connection");
    expect(
      connectorSettingsIssue({ action: "slack.message.post", connectionId: "c1", params: {} })
    ).toBe("Fill in Channel");
    expect(
      connectorSettingsIssue({
        action: "slack.message.post",
        connectionId: "c1",
        params: { channel: "C1" },
      })
    ).toBeNull();
  });

  it("connection issue: missing, wrong provider, personal, dead, scopes", () => {
    const post = connectorAction("slack.message.post")!;
    expect(connectorConnectionIssue(post, null)).toMatch(/no longer exists/);
    expect(connectorConnectionIssue(post, connection({ provider: "salesforce" }))).toMatch(
      /salesforce connection/
    );
    expect(
      connectorConnectionIssue(post, connection({ ownerType: "member", ownerMemberId: "m1" }))
    ).toMatch(/personal connection/);
    expect(
      connectorConnectionIssue(
        post,
        connection({ ownerType: "member", ownerMemberId: "m1" }),
        { allowPersonal: true }
      )
    ).toBeNull();
    expect(
      connectorConnectionIssue(post, connection({ status: "reauthorization_required" }))
    ).toMatch(/reconnected/);
    expect(connectorConnectionIssue(post, connection({ scopes: ["channels:read"] }))).toMatch(
      /chat:write/
    );
    expect(connectorConnectionIssue(post, connection())).toBeNull();
  });

  it("a Drive action is internal-only: refused for a published flow, allowed on operator surfaces", () => {
    const create = connectorAction("onedrive.file.create")!;
    const personal = connection({
      provider: "onedrive",
      ownerType: "member",
      ownerMemberId: "m1",
      scopes: ["Files.ReadWrite"],
    });
    expect(connectorConnectionIssue(create, personal)).toBe(CONNECTOR_INTERNAL_ONLY_REASON);
    expect(connectorConnectionIssue(create, personal, { allowPersonal: true })).toBeNull();
    expect(
      connectorConnectionIssue(create, { ...personal, scopes: ["Files.Read"] }, { allowPersonal: true })
    ).toMatch(/Files\.ReadWrite/);
  });
});
