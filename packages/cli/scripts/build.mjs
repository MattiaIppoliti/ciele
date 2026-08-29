import { chmod, readFile, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

// `ciele --version` reads this: a bundle cannot read its own package.json.
const { version } = JSON.parse(await readFile("package.json", "utf8"));

await build({
  entryPoints: [{ in: "bin/ciele.mjs", out: "ciele" }],
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  sourcesContent: true,
  legalComments: "none",
  define: { __CIELE_VERSION__: JSON.stringify(version) },
});

await chmod("dist/ciele.mjs", 0o755);
