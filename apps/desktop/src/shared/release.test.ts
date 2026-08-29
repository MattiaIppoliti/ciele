import { describe, expect, it } from "vitest";
import { DEV_VERSION, imageTagFor, isDevBuild, releaseVersion } from "./release";

describe("imageTagFor", () => {
  it("pins a stamped build to its own version", () => {
    // Updating the app is what rolls the local stack forward, so the tag has
    // to be this build's version and nothing else.
    expect(imageTagFor("0.4.0")).toBe("v0.4.0");
  });

  it("refuses to guess a tag for a build that was never stamped", () => {
    // The alternative is what the first cut did: pin `v0.0.0-dev`, which
    // exists in no registry, and die at the image pull with a network error
    // nobody can act on.
    expect(imageTagFor(DEV_VERSION)).toBeNull();
  });

  it("lets a contributor name the release they want to run", () => {
    expect(imageTagFor(DEV_VERSION, { CIELE_IMAGE_TAG: "v0.4.0" })).toBe("v0.4.0");
  });

  it("lets an override win over a stamped version, for testing a rollback", () => {
    expect(imageTagFor("0.4.0", { CIELE_IMAGE_TAG: "v0.3.0" })).toBe("v0.3.0");
  });

  it("ignores an override that is only whitespace", () => {
    expect(imageTagFor("0.4.0", { CIELE_IMAGE_TAG: "   " })).toBe("v0.4.0");
  });
});

describe("isDevBuild", () => {
  it("recognises the placeholder the release workflow replaces", () => {
    expect(isDevBuild(DEV_VERSION)).toBe(true);
    expect(isDevBuild("0.4.0")).toBe(false);
  });

  it("uses a version that could never be mistaken for a release", () => {
    // `0.1.0` would look like one, and both failures it causes are silent.
    expect(DEV_VERSION).not.toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("releaseVersion", () => {
  it("trusts the reported version only once the app is packaged", () => {
    expect(releaseVersion(true, "0.4.0")).toBe("0.4.0");
  });

  it("calls an unpackaged build what it is, whatever Electron reported", () => {
    // Launched as a raw script, `app.getVersion()` returns ELECTRON's version.
    // Taken at face value that build looks stamped: it would nag about updates
    // against a repository with no v43 release, and pin the local stack to an
    // image tag nobody will publish.
    expect(releaseVersion(false, "43.3.0")).toBe(DEV_VERSION);
  });

  it("still says dev when the unpackaged build reported the placeholder", () => {
    expect(releaseVersion(false, DEV_VERSION)).toBe(DEV_VERSION);
  });
});
