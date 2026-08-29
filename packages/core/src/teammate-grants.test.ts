import { describe, expect, it } from "vitest";
import {
  actionRefusal,
  ceilingAllowsCapability,
  grantedDomains,
  hasGrant,
  mayAcceptSuggestedFix,
} from "./teammate-grants";
import type { TeammateGrant } from "./types";

function grant(domain: TeammateGrant["domain"]): Pick<TeammateGrant, "domain"> {
  return { domain };
}

describe("ceilingAllowsCapability", () => {
  it("lets a granted operation through at or under the ceiling", () => {
    expect(ceilingAllowsCapability("edit", "member")).toBe(true);
    expect(ceilingAllowsCapability("edit", "edit")).toBe(true);
  });

  it("caps a granted domain at the ceiling", () => {
    // The reading half of a domain survives a `member` ceiling; the writing
    // half does not. This is the whole point of having a ceiling beside the
    // grant rather than folding the two into one switch.
    expect(ceilingAllowsCapability("member", "member")).toBe(true);
    expect(ceilingAllowsCapability("member", "edit")).toBe(false);
    expect(ceilingAllowsCapability("edit", "publish")).toBe(false);
  });

  it("refuses org administration at every ceiling", () => {
    for (const ceiling of ["member", "edit"] as const) {
      expect(ceilingAllowsCapability(ceiling, "manageMembers")).toBe(false);
      expect(ceilingAllowsCapability(ceiling, "manageApiKeys")).toBe(false);
      expect(ceilingAllowsCapability(ceiling, "changeRoles")).toBe(false);
    }
  });

  it("refuses a capability it has never heard of", () => {
    // A capability added to the operations layer later must not land under
    // `edit` by accident: unknown is denied until somebody decides.
    expect(ceilingAllowsCapability("edit", "impersonate")).toBe(false);
    expect(ceilingAllowsCapability("edit", "")).toBe(false);
  });
});

describe("grants", () => {
  it("reports a held domain and refuses an absent one", () => {
    const grants = [grant("improvements")];
    expect(hasGrant(grants, "improvements")).toBe(true);
    expect(hasGrant(grants, "knowledge")).toBe(false);
    expect(hasGrant([], "improvements")).toBe(false);
  });

  it("lists held domains in the vocabulary's order, not the rows'", () => {
    expect(grantedDomains([grant("inbox"), grant("improvements")])).toEqual([
      "improvements",
      "inbox",
    ]);
  });

  it("collapses duplicate rows for one domain", () => {
    expect(grantedDomains([grant("knowledge"), grant("knowledge")])).toEqual([
      "knowledge",
    ]);
  });
});

describe("mayAcceptSuggestedFix", () => {
  it("refuses without the bypass, whatever the grants", () => {
    expect(
      mayAcceptSuggestedFix({ approvalBypass: false }, [
        "knowledge",
        "improvements",
      ])
    ).toBe(false);
  });

  it("refuses a bypass with no knowledge grant", () => {
    // The bypass relaxes who may approve the write; it does not hand out the
    // write itself. Accepting a fix creates a FAQ Concept, so it needs the
    // knowledge domain like any other knowledge write.
    expect(
      mayAcceptSuggestedFix({ approvalBypass: true }, ["improvements"])
    ).toBe(false);
    expect(mayAcceptSuggestedFix({ approvalBypass: true }, [])).toBe(false);
  });

  it("allows the one combination an admin set on purpose", () => {
    expect(
      mayAcceptSuggestedFix({ approvalBypass: true }, ["knowledge"])
    ).toBe(true);
  });
});

describe("actionRefusal", () => {
  it("names the domain and tells the model to stop retrying", () => {
    const message = actionRefusal("inbox");
    expect(message).toContain("inbox");
    expect(message).toContain("administrator");
    expect(message).toMatch(/do not try again/i);
  });
});
