// First-load JS per prerendered route, raw + gzip.
//
// Why this exists: Next 16 dropped the size columns from `next build` output,
// writes no `app-build-manifest.json` under Turbopack, and `@next/bundle-analyzer`
// refuses to run at all ("not compatible with Turbopack builds, no report will
// be generated"). What is left is ground truth: the <script> tags Next actually
// put in each prerendered page. Those are the bytes a first-time visitor pays.
//
//   pnpm --filter @agent-hub/web build
//   pnpm --filter @agent-hub/web measure:bundle
//
// Only statically prerendered routes appear, a dynamic route emits no HTML at
// build time. That covers the whole marketing surface plus a few admin pages,
// which is where first-load regressions matter most. For module-level
// attribution (which package is the weight), use `pnpm analyze` instead; see
// docs/runbooks/bundle-measurement.md.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const web = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const next = join(web, ".next");
const appDir = join(next, "server", "app");

if (!existsSync(appDir)) {
  console.error(`No build found at ${appDir}. Run \`next build\` first.`);
  process.exit(1);
}

function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(path, out);
    else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out;
}

// Gzip is per chunk and memoised: chunks are shared across routes, and gzipping
// the same 200 KB framework chunk once per route dominated the runtime.
const measured = new Map();
function sizeOf(chunk) {
  const cached = measured.get(chunk);
  if (cached) return cached;
  const path = join(next, chunk.replace(/^\/_next\//, ""));
  const value = existsSync(path)
    ? (() => {
        const buf = readFileSync(path);
        return { raw: buf.length, gz: gzipSync(buf, { level: 9 }).length };
      })()
    : { raw: 0, gz: 0 };
  measured.set(chunk, value);
  return value;
}

const rows = [];
for (const html of htmlFiles(appDir)) {
  const chunks = [
    ...new Set(
      [
        ...readFileSync(html, "utf8").matchAll(
          /["'](\/_next\/static\/[^"']+?\.js)["']/g
        ),
      ].map((match) => match[1])
    ),
  ];
  if (!chunks.length) continue;
  const route =
    "/" + relative(appDir, html).replace(/\.html$/, "").split(sep).join("/");
  rows.push({
    route,
    chunks: chunks.length,
    raw: chunks.reduce((n, c) => n + sizeOf(c).raw, 0),
    gz: chunks.reduce((n, c) => n + sizeOf(c).gz, 0),
  });
}

rows.sort((a, b) => b.gz - a.gz);
const kb = (n) => (n / 1024).toFixed(1);
console.log("\nfirst-load JS per prerendered route (heaviest first)\n");
for (const row of rows) {
  console.log(
    `${row.route.padEnd(40)} ${kb(row.raw).padStart(9)} KB raw ${kb(row.gz).padStart(
      8
    )} KB gz  (${row.chunks} chunks)`
  );
}
console.log(
  `\n${rows.length} routes; ${measured.size} distinct chunks; ` +
    `floor ${kb(Math.min(...rows.map((r) => r.gz)))} KB gz, ` +
    `peak ${kb(Math.max(...rows.map((r) => r.gz)))} KB gz\n`
);
