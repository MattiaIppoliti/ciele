import { describe, expect, it } from "vitest";
import type { ApplicationConnection } from "@agent-hub/core";
import {
  canAuthorizeApplicationProvider,
  canDeleteApplicationConnection,
  canReconnectApplicationConnection,
  redactApplicationConnection,
} from "./application-connections";

describe("redactApplicationConnection", () => {
  it("does not expose sealed provider credentials to Client Components", () => {
    const connection = {
      id: "connection-1",
      organizationId: "organization-1",
      ownerType: "organization",
      ownerMemberId: null,
      provider: "slack",
      name: "Slack",
      status: "connected",
      sealedCredentials: "sealed-secret",
      scopes: [],
      providerAccountId: null,
      metadata: {},
      error: "",
      lastConnectedAt: null,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    } satisfies ApplicationConnection;

    const safe = redactApplicationConnection(connection);

    expect(safe).not.toHaveProperty("sealedCredentials");
    expect(connection.sealedCredentials).toBe("sealed-secret");
  });
});

describe("Application Connection authorization", () => {
  const personal = {
    id: "drive-1",
    organizationId: "organization-1",
    ownerType: "member",
    ownerMemberId: "member-1",
    provider: "google_drive",
    name: "My Drive",
    status: "connected",
    sealedCredentials: "sealed-secret",
    scopes: [],
    providerAccountId: null,
    metadata: {},
    error: "",
    lastConnectedAt: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  } satisfies ApplicationConnection;

  it("lets Editors authorize personal providers but not Organization providers", () => {
    expect(canAuthorizeApplicationProvider("google_drive", "editor")).toBe(true);
    expect(canAuthorizeApplicationProvider("salesforce", "editor")).toBe(false);
  });

  it("keeps reconnect personal to the owner while allowing admin deletion", () => {
    expect(canReconnectApplicationConnection(personal, "member-1", "editor")).toBe(true);
    expect(canReconnectApplicationConnection(personal, "member-2", "admin")).toBe(false);
    expect(canDeleteApplicationConnection(personal, "member-2", "admin")).toBe(true);
  });
});
