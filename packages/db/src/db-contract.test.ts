import { describeDbContract } from "./db-contract.suite";
import { getMockDb, DEMO_MEMBER, DEMO_ORG } from "./index";

describeDbContract("mock", async () => {
  const db = getMockDb();
  const foreignOrganizationId = "00000000-0000-0000-0000-00000000dead";
  const foreignAssistant = await db.createAssistant(foreignOrganizationId, {
    title: "Foreign Contract Assistant",
  });
  return {
    db,
    organizationId: DEMO_ORG.id,
    organizationName: DEMO_ORG.name,
    userId: DEMO_MEMBER.userId,
    // Well-formed uuids so the same values also satisfy adapters with uuid org keys.
    missingOrganizationId: "00000000-0000-0000-0000-000000000000",
    foreignOrganizationId,
    foreignAssistantId: foreignAssistant.id,
  };
});
