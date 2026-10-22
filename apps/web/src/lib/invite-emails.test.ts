import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_INVITES_PER_SUBMIT, describeInviteOutcome, parseInviteEmails, planInvites } from "./invite-emails";

describe("parseInviteEmails (#1074)", () => {
  it("splits on commas, semicolons, spaces and new lines", () => {
    expect(parseInviteEmails("a@x.io, b@x.io;c@x.io d@x.io\ne@x.io").emails).toEqual([
      "a@x.io",
      "b@x.io",
      "c@x.io",
      "d@x.io",
      "e@x.io",
    ]);
  });

  it("lower-cases and drops repeats, keeping the typed order", () => {
    expect(parseInviteEmails("B@x.io, a@x.io, b@X.io").emails).toEqual(["b@x.io", "a@x.io"]);
  });

  it("keeps the address from a mail client's display form", () => {
    const parsed = parseInviteEmails("Ada Lovelace <ada@example.com>, Grace Hopper <grace@example.com>");
    expect(parsed.emails).toEqual(["ada@example.com", "grace@example.com"]);
    expect(parsed.invalid).toEqual([]);
  });

  it("names what is not an address, as typed", () => {
    const parsed = parseInviteEmails("ok@x.io, nope, also@bad");
    expect(parsed.emails).toEqual(["ok@x.io"]);
    expect(parsed.invalid).toEqual(["nope", "also@bad"]);
  });

  it("is empty for blank input, which still means one link without an email", () => {
    expect(parseInviteEmails("  ,; \n")).toEqual({ emails: [], invalid: [], tooMany: false });
  });

  it("flags more than one submit can create", () => {
    const many = Array.from({ length: MAX_INVITES_PER_SUBMIT + 1 }, (_, i) => `p${i}@x.io`).join(",");
    expect(parseInviteEmails(many).tooMany).toBe(true);
  });

  it("refuses what the invite operation's schema refuses, before any invite exists", () => {
    // Both looked like addresses to a hand-written pattern and threw inside
    // the loop, after the first address was already invited.
    const parsed = parseInviteEmails("ok@x.io, a@x.c, a..b@x.io");
    expect(parsed.emails).toEqual(["ok@x.io"]);
    expect(parsed.invalid).toEqual(["a@x.c", "a..b@x.io"]);
  });

  it("agrees with the operation's own schema on every address it keeps or refuses", () => {
    const schema = z.string().email();
    const typed = ["ok@x.io", "a@x.c", "a..b@x.io", "x@localhost", "a.b+c@x.io", "Ada@Example.COM", "a@-x.io"];
    const parsed = parseInviteEmails(typed.join(", "));
    for (const email of parsed.emails) expect(schema.safeParse(email).success).toBe(true);
    for (const raw of parsed.invalid) expect(schema.safeParse(raw.toLowerCase()).success).toBe(false);
    expect(parsed.emails.length + parsed.invalid.length).toBe(typed.length);
  });
});

describe("planInvites (#1074)", () => {
  it("creates only the addresses with no invite and no membership", () => {
    expect(
      planInvites(["a@x.io", "b@x.io", "c@x.io"], { invited: ["B@x.io"], members: ["c@x.io"] })
    ).toEqual({ create: ["a@x.io"], alreadyInvited: ["b@x.io"], alreadyMembers: ["c@x.io"] });
  });

  it("makes a retried submit create nothing twice", () => {
    const emails = ["a@x.io", "b@x.io", "c@x.io"];
    // The first attempt reached a and b before failing on c.
    const retry = planInvites(emails, { invited: ["a@x.io", "b@x.io"], members: [] });
    expect(retry.create).toEqual(["c@x.io"]);
  });
});

describe("describeInviteOutcome (#1074)", () => {
  const none = { created: [], alreadyInvited: [], alreadyMembers: [], failed: [] };

  it("keeps only the addresses that failed in the box", () => {
    const outcome = describeInviteOutcome({
      ...none,
      created: [{}, {}],
      failed: [{ email: "c@x.io", message: "Invite not saved" }],
    });
    expect(outcome).toEqual({
      tone: "error",
      message: "Could not invite c@x.io: Invite not saved. 2 invites created",
      keep: "c@x.io",
    });
  });

  it("empties the box when everything went through, naming what it skipped", () => {
    expect(
      describeInviteOutcome({ ...none, created: [{}], alreadyInvited: ["b@x.io"], alreadyMembers: ["c@x.io"] })
    ).toEqual({
      tone: "success",
      message: "1 invite created. Already invited: b@x.io. Already members: c@x.io",
      keep: "",
    });
  });

  it("lists several failures by address", () => {
    const outcome = describeInviteOutcome({
      ...none,
      failed: [
        { email: "a@x.io", message: "x" },
        { email: "b@x.io", message: "y" },
      ],
    });
    expect(outcome.message).toBe("Could not invite 2 addresses: a@x.io, b@x.io");
    expect(outcome.keep).toBe("a@x.io, b@x.io");
  });
});
