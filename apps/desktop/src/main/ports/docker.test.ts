import { describe, expect, it } from "vitest";
import { candidatePaths } from "./docker";

describe("candidatePaths", () => {
  it("finds Docker where a Finder-launched app must look for it", () => {
    // The whole reason this function exists: a macOS app launched from the
    // Dock inherits none of the shell's PATH, so `spawn("docker")` fails with
    // ENOENT on a machine where the terminal finds it instantly.
    const paths = candidatePaths({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: "/Users/x" });

    expect(paths).toContain("/usr/local/bin/docker");
    expect(paths).toContain("/opt/homebrew/bin/docker");
    expect(paths).toContain("/Users/x/.docker/bin/docker");
    expect(paths).toContain("/Applications/Docker.app/Contents/Resources/bin/docker");
  });

  it("prefers what is on PATH, when there is a PATH to read", () => {
    // A developer running from a terminal, or a machine with a deliberate
    // install: their choice wins over our guesses.
    const paths = candidatePaths({ PATH: "/custom/bin", HOME: "/Users/x" });

    expect(paths[0]).toBe("/custom/bin/docker");
  });

  it("still has somewhere to look with no PATH at all", () => {
    const paths = candidatePaths({ HOME: "/Users/x" });

    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toContain("/usr/local/bin/docker");
  });

  it("never yields an empty or relative candidate", () => {
    // An empty PATH entry means "the current directory" to the shell, and
    // spawning `./docker` from wherever the app happens to be is not a thing
    // this should ever do.
    const paths = candidatePaths({ PATH: "/usr/bin::/bin:", HOME: "/Users/x" });

    for (const candidate of paths) {
      expect(candidate.startsWith("/")).toBe(true);
    }
  });
});
