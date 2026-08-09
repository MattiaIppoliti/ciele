import { chmod, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

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
});

await chmod("dist/ciele.mjs", 0o755);
