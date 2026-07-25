import { describeDbContract } from "./db-contract.suite";
import { getMockDb, DEMO_MEMBER, DEMO_ORG } from "./index";

describeDbContract("mock", () => ({
  db: getMockDb(),
  organizationId: DEMO_ORG.id,
  organizationName: DEMO_ORG.name,
  userId: DEMO_MEMBER.userId,
  // Well-formed uuids so the same values also satisfy adapters with uuid org keys.
  missingOrganizationId: "00000000-0000-0000-0000-000000000000",
  foreignOrganizationId: "00000000-0000-0000-0000-00000000dead",
  // The demo store ships teammates; hand one over (the cascade case removes
  // them, and nothing else in the suite depends on that teammate).
  seedOrgMember: async () => "u-valeria",
}));
