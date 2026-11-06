import { describe, expect, it } from "vitest";
import {
  AUDIT_LOG_MAX_LIMIT,
  auditActorKind,
  auditLogFilter,
  auditLogQuery,
  formatAuditWhen,
  formatChangeValue,
  isFiltered,
  parseAuditLogView,
} from "./audit-log";

describe("audit log view", () => {
  it("reads the filters from the query and drops what is not a filter", () => {
    const view = parseAuditLogView({
      action: "members.updateRole,DROP TABLE,apiKeys.create",
      actor: "system",
      from: "2026-11-01",
      to: "not a date",
      sort: "asc",
      limit: "99999",
    });
    expect(view).toEqual({
      actions: ["members.updateRole", "apiKeys.create"],
      actor: "system",
      domain: "",
      from: "2026-11-01",
      to: "",
      oldest: true,
      limit: AUDIT_LOG_MAX_LIMIT,
    });
    expect(isFiltered(view)).toBe(true);
    expect(isFiltered(parseAuditLogView({}))).toBe(false);
  });

  it("keeps a link from before the actor filter working", () => {
    expect(parseAuditLogView({ memberId: "u-1", domain: "assistants" })).toMatchObject({ actor: "u-1", domain: "assistants" });
  });

  it("turns the view into the Db filter with whole UTC days", () => {
    const filter = auditLogFilter(parseAuditLogView({ action: "members.remove", from: "2026-11-01", to: "2026-11-04" }));
    expect(filter).toEqual({
      operations: ["members.remove"],
      memberId: undefined,
      domain: undefined,
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-04T23:59:59.999Z",
      order: "newest",
      limit: 100,
    });
  });

  it("writes the query back with defaults left out", () => {
    expect(auditLogQuery(parseAuditLogView({}))).toBe("");
    expect(auditLogQuery(parseAuditLogView({ actor: "u-1", sort: "asc", limit: "200" }))).toBe("?actor=u-1&sort=asc&limit=200");
  });

  it("names a key or a Teammate before the Member behind it, and nobody as the system", () => {
    expect(auditActorKind({ memberId: "u-1", apiKeyId: "k-1", teammateId: null })).toBe("apiKey");
    expect(auditActorKind({ memberId: "u-1", apiKeyId: null, teammateId: "t-1" })).toBe("teammate");
    expect(auditActorKind({ memberId: "u-1", apiKeyId: null, teammateId: null })).toBe("member");
    expect(auditActorKind({ memberId: null, apiKeyId: null, teammateId: null })).toBe("system");
  });

  it("formats times in UTC and values for the detail sheet", () => {
    expect(formatAuditWhen("2026-11-04T13:10:00.000Z")).toBe("04 Nov 2026, 13:10 UTC");
    expect(formatChangeValue(null)).toBe("None");
    expect(formatChangeValue("Admin")).toBe("Admin");
    expect(formatChangeValue({ messages: 90 })).toBe('{\n  "messages": 90\n}');
  });
});
