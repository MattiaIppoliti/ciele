import { describe, expect, it } from "vitest";
import {
  generatedAvatar,
  personAvatarSeed,
  rosterAvatarSeed,
  teammateAvatarSeed,
} from "./avatar";

/**
 * The generated avatars (blobatar). The component that draws them is `.tsx` and
 * outside this app's vitest include, so what is testable is the part that
 * decides identity: the seed, and that the drawing is deterministic.
 */

describe("generatedAvatar", () => {
  it("is the same drawing for the same seed, every time", () => {
    // The whole reason nothing is stored. A face that varied per render would
    // read as a different person on every page.
    expect(generatedAvatar("tm-1")).toBe(generatedAvatar("tm-1"));
  });

  it("is a different drawing for a different seed", () => {
    expect(generatedAvatar("tm-1")).not.toBe(generatedAvatar("tm-2"));
  });

  it("emits sizeable SVG: a viewBox and no fixed width", () => {
    const svg = generatedAvatar("tm-1");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
    // No width/height attribute, so the element around it decides the size and
    // one component serves a 32px row and a 44px card.
    expect(svg).not.toMatch(/\swidth="/);
  });

  it("draws something for a seed that is only punctuation or spaces", () => {
    // Seeds come from ids and addresses, but a hostile or empty-ish one must
    // still produce a figure rather than an empty element.
    expect(generatedAvatar(" ")).toContain("<svg");
    expect(generatedAvatar("---")).toContain("<svg");
  });
});

describe("teammateAvatarSeed", () => {
  it("prefers the chosen seed, so a rename keeps the same face", () => {
    expect(teammateAvatarSeed({ id: "tm-1", avatarSeed: "nora" })).toBe("nora");
  });

  it("falls back to the id when nobody chose one", () => {
    expect(teammateAvatarSeed({ id: "tm-1", avatarSeed: "" })).toBe("tm-1");
    expect(teammateAvatarSeed({ id: "tm-1", avatarSeed: "   " })).toBe("tm-1");
    expect(teammateAvatarSeed({ id: "tm-1" })).toBe("tm-1");
    expect(teammateAvatarSeed({ id: "tm-1", avatarSeed: null })).toBe("tm-1");
  });
});

describe("personAvatarSeed", () => {
  it("prefers the user id, which survives an email change", () => {
    expect(
      personAvatarSeed({ userId: "u-1", email: "marco@example.edu" })
    ).toBe("u-1");
  });

  it("seeds a pending invite from the address it was sent to", () => {
    // So the face on the invite row is the face they keep once they accept.
    expect(personAvatarSeed({ userId: null, email: "marco@example.edu" })).toBe(
      "marco@example.edu"
    );
  });

  it("is null when there is nothing stable to seed from", () => {
    // An open invite link names nobody yet: the caller falls back to the
    // generic silhouette rather than inventing an identity.
    expect(personAvatarSeed({ userId: "", email: "" })).toBeNull();
    expect(personAvatarSeed({})).toBeNull();
  });

  it("gives two people with the same name two different faces", () => {
    const one = personAvatarSeed({ userId: "u-1" });
    const two = personAvatarSeed({ userId: "u-2" });
    expect(generatedAvatar(one!)).not.toBe(generatedAvatar(two!));
  });
});

describe("rosterAvatarSeed", () => {
  const teammates = [{ id: "t-1", avatarSeed: "chief" }];

  it("gives a seated Teammate the same face the roster header draws", () => {
    // The two roster surfaces disagreed: one looked the seed up, the other
    // seeded from the id, so one Teammate wore two faces on one screen.
    expect(rosterAvatarSeed({ id: "t-1", kind: "teammate" }, teammates)).toBe(
      "chief"
    );
  });

  it("falls back to the id for a Teammate that picked no seed", () => {
    expect(
      rosterAvatarSeed({ id: "t-2", kind: "teammate" }, [
        { id: "t-2", avatarSeed: null },
      ])
    ).toBe("t-2");
  });

  it("seeds a Member from its user id, which is the person seed", () => {
    expect(rosterAvatarSeed({ id: "u-1", kind: "member" }, teammates)).toBe(
      "u-1"
    );
  });

  it("falls back to the id for a Teammate no longer in the list", () => {
    // The roster and the Teammate list are two fetches; a removal between them
    // must still draw a face rather than throw.
    expect(rosterAvatarSeed({ id: "t-9", kind: "teammate" }, teammates)).toBe(
      "t-9"
    );
  });
});
