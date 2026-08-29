import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  requireMember: vi.fn(),
  requireSession: vi.fn(),
}));

import { requireMember } from "@/lib/authz";
import {
  updateCompostOptOutAction,
  updatePersonalAiSubscriptionsAllowedAction,
} from "./actions";

describe("updateCompostOptOutAction", () => {
  const requireMemberMock = vi.mocked(requireMember);
  let db: Db;

  beforeEach(() => {
    db = getMockDb();
    requireMemberMock.mockReset();
    requireMemberMock.mockResolvedValue({
      db,
      session: { organization: DEMO_ORG },
    } as never);
  });

  it("toggles the org compost opt-out through the admin-gated action", async () => {
    // Default: opted in.
    expect(await db.getCompostOptOut(DEMO_ORG.id)).toBe(false);

    await updateCompostOptOutAction(true);
    expect(requireMemberMock).toHaveBeenCalledWith("manageMembers");
    expect(await db.getCompostOptOut(DEMO_ORG.id)).toBe(true);

    await updateCompostOptOutAction(false);
    expect(await db.getCompostOptOut(DEMO_ORG.id)).toBe(false);
  });

  it("lets only the owner-gated action opt the Organization into personal subscriptions", async () => {
    expect(await db.getPersonalAiSubscriptionsAllowed(DEMO_ORG.id)).toBe(false);

    await updatePersonalAiSubscriptionsAllowedAction(true);
    expect(requireMemberMock).toHaveBeenLastCalledWith("changeRoles");
    expect(await db.getPersonalAiSubscriptionsAllowed(DEMO_ORG.id)).toBe(true);

    await updatePersonalAiSubscriptionsAllowedAction(false);
    expect(await db.getPersonalAiSubscriptionsAllowed(DEMO_ORG.id)).toBe(false);
  });
});
