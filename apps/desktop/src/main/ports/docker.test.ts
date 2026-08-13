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

  it("finds Docker Desktop for Windows, machine-wide and per-user", () => {
    const paths = candidatePaths(
      {
        PATH: "C:\\Windows\\system32;C:\\Windows",
        ProgramFiles: "C:\\Program Files",
        LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local",
      },
      "win32",
    );

    expect(paths).toContain("C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe");
    expect(paths).toContain(
      "C:\\Users\\x\\AppData\\Local\\Programs\\Docker\\Docker\\resources\\bin\\docker.exe",
    );
  });

  it("splits a Windows PATH on semicolons and appends the executable suffix", () => {
    const paths = candidatePaths(
      { PATH: "C:\\custom\\bin;D:\\tools", ProgramFiles: "C:\\Program Files" },
      "win32",
    );

    expect(paths[0]).toBe("C:\\custom\\bin\\docker.exe");
    expect(paths[1]).toBe("D:\\tools\\docker.exe");
  });

  it("still has somewhere to look on Windows with no env at all", () => {
    const paths = candidatePaths({}, "win32");

    expect(paths).toContain("C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe");
  });

  it("never mixes platforms: a win32 list has no unix paths and vice versa", () => {
    // A unix path on Windows (or the reverse) can never exist, so probing it
    // is wasted syscalls at best and a false "found" on a weird mount at worst.
    for (const candidate of candidatePaths({ PATH: "" }, "win32")) {
      expect(candidate.startsWith("/")).toBe(false);
    }
    for (const candidate of candidatePaths({ PATH: "", HOME: "/Users/x" }, "darwin")) {
      expect(candidate.endsWith(".exe")).toBe(false);
    }
  });
});

describe("candidatePaths (macOS details)", () => {
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
