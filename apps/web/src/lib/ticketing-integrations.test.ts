import { describe, expect, it } from "vitest";
import { ticketingConnectionOptions, ticketingTargetSummary } from "./ticketing-integrations";

describe("ticketingConnectionOptions (#1088)", () => {
  it("offers Organization-owned Salesforce and ServiceNow connections only", () => {
    const options = ticketingConnectionOptions([
      { id: "sf", provider: "salesforce", name: "Service org", status: "connected", ownerType: "organization" },
      { id: "sn", provider: "servicenow", name: "Instance", status: "connected", ownerType: "organization" },
      { id: "slack", provider: "slack", name: "Slack", status: "connected", ownerType: "organization" },
      { id: "mine", provider: "salesforce", name: "Mine", status: "connected", ownerType: "member" },
    ]);
    expect(options.map((option) => option.id)).toEqual(["sf", "sn"]);
  });
});

describe("ticketingTargetSummary", () => {
  it("names the connection and where records go", () => {
    expect(ticketingTargetSummary({ provider: "salesforce", connectionId: "sf" }, { name: "Service org" })).toBe(
      "Service org · Cases"
    );
    expect(
      ticketingTargetSummary(
        { provider: "servicenow", connectionId: "sn", table: "incident", requesterEmailField: "u_email" },
        null
      )
    ).toBe("A deleted connection · incident table, requester email in u_email");
  });
});
