import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);

/**
 * Installation is a public boundary: prove the packed artifact works from a
 * directory that has no access to this monorepo or its workspace packages.
 */
describe("installed ciele CLI", () => {
  it("packs a standalone executable that operates a local Ciele deployment", async () => {
    const packDir = mkdtempSync(join(tmpdir(), "ciele-pack-"));
    const installDir = mkdtempSync(join(tmpdir(), "ciele-install-"));

    const tarballName = execFileSync(
      "pnpm",
      ["pack", "--pack-destination", packDir, "--json"],
      { cwd: packageRoot, encoding: "utf8" }
    );
    const manifestStart = tarballName.indexOf('{\n  "name"');
    expect(manifestStart).toBeGreaterThanOrEqual(0);
    const { filename } = JSON.parse(tarballName.slice(manifestStart)) as {
      filename: string;
    };

    execFileSync(
      "npm",
      ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", installDir, filename],
      { cwd: installDir, encoding: "utf8" }
    );

    const installedManifest = JSON.parse(
      readFileSync(join(installDir, "node_modules/@ciele/cli/package.json"), "utf8")
    ) as { private?: boolean; files?: string[] };
    expect(installedManifest.private).not.toBe(true);
    expect(installedManifest.files).toEqual(expect.arrayContaining(["dist"]));

    const output = execFileSync(join(installDir, "node_modules/.bin/ciele"), ["help"], {
      cwd: installDir,
      encoding: "utf8",
    });
    expect(output).toContain("ciele, manage your Organization from the terminal");

    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.setHeader("content-type", "application/json");
      if (request.url === "/api/v1/meta") {
        response.end(JSON.stringify({ api: "ciele", apiVersion: 1, serverVersion: "local-test", domains: ["assistants"] }));
      } else if (request.url === "/api/v1/whoami") {
        response.end(JSON.stringify({ organizationId: "org-local", role: "owner", keyId: "key-local" }));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: { code: "not_found", message: "Not found" } }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test server port");
      const result = await execFileAsync(
        join(installDir, "node_modules/.bin/ciele"),
        ["doctor", "--base-url", `http://127.0.0.1:${address.port}`, "--api-key", "ciele_sk_local"],
        { cwd: installDir, encoding: "utf8" }
      );
      expect(result.stdout).toContain("org-local");
      expect(result.stdout).toContain("local-test");
      expect(requests).toEqual(["/api/v1/meta", "/api/v1/whoami"]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  // Budget, not a latency assertion. This test runs a real `pnpm pack` and a
  // real `npm install` into a temp prefix, so its wall time is whatever the
  // machine and the npm cache give it. Thirty seconds passed on a warm laptop
  // and timed out at eighty on a cold checkout, which is exactly the state a
  // release gate or a fresh CI runner starts from.
  }, 300_000);
});
