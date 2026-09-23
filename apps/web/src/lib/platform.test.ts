import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@agent-hub/db";

const supabase = vi.hoisted(() => ({ configured: true }));
vi.mock("@agent-hub/db", () => ({ isSupabaseConfigured: () => supabase.configured }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn, updateTag: () => {} }));
vi.mock("@agent-hub/agent", () => ({ DEFAULT_PLATFORM_PROMPT: "default" }));
vi.mock("./widget-db", () => ({ getWidgetDb: () => ({}) }));

import { isPlatformOwner, platformOwnerOrganizationIds } from "./platform";

function fakeDb(members: Record<string, string[]>): Db {
  return {
    listOrganizations: async () => Object.keys(members).map((id) => ({ id, name: id })),
    listMembers: async (organizationId: string) => {
      if (!(organizationId in members)) throw new Error("no such org");
      return members[organizationId].map((email) => ({ id: email, email }));
    },
  } as unknown as Db;
}

afterEach(() => {
  delete process.env.PLATFORM_OWNER_EMAIL;
  supabase.configured = true;
});

describe("platformOwnerOrganizationIds", () => {
  it("names the Organizations a platform owner belongs to, and only those", async () => {
    process.env.PLATFORM_OWNER_EMAIL = "Owner@Example.com, second@example.com";
    const db = fakeDb({
      "org-owner": ["owner@example.com", "someone@tenant.it"],
      "org-tenant": ["admin@tenant.it"],
      "org-second": ["second@example.com"],
    });
    expect(await platformOwnerOrganizationIds(db)).toEqual(["org-owner", "org-second"]);
  });

  it("is empty when no owner is configured, so a platform Alert has nowhere to land rather than everywhere", async () => {
    const db = fakeDb({ "org-a": ["a@tenant.it"] });
    expect(await platformOwnerOrganizationIds(db)).toEqual([]);
    expect(isPlatformOwner("a@tenant.it")).toBe(false);
  });

  it("is every Organization in demo mode, where everyone is the owner", async () => {
    supabase.configured = false;
    const db = fakeDb({ "org-a": ["a@tenant.it"], "org-b": ["b@tenant.it"] });
    expect(await platformOwnerOrganizationIds(db)).toEqual(["org-a", "org-b"]);
  });
});
