import { describe, expect, it } from "vitest";
import { TEAMMATE_GRANT_DOMAINS } from "@agent-hub/core";
import {
  CEILING_COPY,
  GRANT_DOMAIN_COPY,
  bypassBlockedReason,
  grantSummary,
} from "./grant-copy";

/**
 * The sentence a Member reads before handing an agent write access to their
 * knowledge base. Tested because it is the only place the permission model is
 * stated in words rather than types, and a wrong word here is a wrong decision.
 */

describe("grantSummary", () => {
  it("says plainly what an ungranted Teammate is", () => {
    // The default state of every new Teammate, and the one a Member is most
    // likely to misread from three empty checkboxes.
    expect(grantSummary([], "edit", false)).toContain("can only talk");
  });

  it("lists granted domains and reads the ceiling", () => {
    expect(grantSummary(["improvements"], "edit", false)).toBe(
      "This teammate can act in improvements."
    );
    expect(grantSummary(["improvements"], "member", false)).toBe(
      "This teammate can read improvements."
    );
    expect(grantSummary(["improvements", "inbox"], "edit", false)).toBe(
      "This teammate can act in improvements and inbox."
    );
    expect(
      grantSummary(["improvements", "knowledge", "inbox"], "edit", false)
    ).toBe("This teammate can act in improvements, knowledge and inbox.");
  });

  it("spells out the bypass, and only when it actually applies", () => {
    expect(grantSummary(["knowledge"], "edit", true)).toContain(
      "without anyone reviewing"
    );
    // A bypass with no knowledge grant does nothing, so the summary must not
    // claim it does.
    expect(grantSummary(["improvements"], "edit", true)).not.toContain(
      "without anyone reviewing"
    );
  });
});

describe("bypassBlockedReason", () => {
  it("names the missing grant rather than just disabling the switch", () => {
    expect(bypassBlockedReason([])).toContain("Knowledge");
    expect(bypassBlockedReason(["knowledge"])).toContain("Improvements");
  });

  it("offers the switch once both halves are granted", () => {
    expect(bypassBlockedReason(["knowledge", "improvements"])).toBeNull();
  });
});

describe("the panel covers the vocabulary", () => {
  it("has copy for every grantable domain", () => {
    // A domain added to the core vocabulary with no copy here would render as
    // an unexplained checkbox, or not render at all.
    expect(GRANT_DOMAIN_COPY.map((copy) => copy.domain)).toEqual([
      ...TEAMMATE_GRANT_DOMAINS,
    ]);
  });

  it("has copy for every ceiling rung", () => {
    expect(CEILING_COPY.map((copy) => copy.ceiling)).toEqual([
      "member",
      "edit",
    ]);
  });
});
