import { describe, expect, it } from "vitest";
import { TABLE_EXPOSURE, pinnedTableNames, type TableExposureMap } from "./org-pinned";

/**
 * Which generic tables the org-pinned Db exposes over the API-key surface.
 * Once a remembered edit to a Set, which is how `teammates` shipped without
 * it and all seven Teammate endpoints threw on their first real call. Now a
 * map with one entry per `DbTableMap` table: `tsc` refuses a table nobody
 * decided about, and refuses pinning one whose rows carry no Organization to
 * pin on.
 */

// A cookie consent record is not an Organization's row (no `organizationId`),
// so the pinning has nothing to filter or stamp. The type says so:
// @ts-expect-error pinning needs an organizationId on the row
const cannotPinConsent: TableExposureMap["cookieConsentRecords"] = "pinned";
void cannotPinConsent;

describe("org-pinned table exposure", () => {
  it("exposes exactly the tables an /api/v1 route or the api-surface gate reaches", () => {
    expect([...pinnedTableNames()].sort()).toEqual([
      "assistantGoals",
      "entities",
      "httpFlowRuns",
      "knowledgeMemories",
      "projects",
      "reviewRequests",
      "skills",
      "teammateChannelParticipants",
      "teammateChannels",
      "teammateGrants",
      "teammateRoutines",
      "teammates",
    ]);
  });

  it("says why every hidden table is hidden", () => {
    for (const [table, exposure] of Object.entries(TABLE_EXPOSURE)) {
      if (exposure === "pinned") continue;
      expect(exposure.hidden.length, table).toBeGreaterThan(10);
    }
  });
});
