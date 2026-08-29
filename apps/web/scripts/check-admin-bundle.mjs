// Route-incremental client-JS budgets for the latency-sensitive admin pages.
// Run after `next build`; shared admin-shell chunks are excluded so a page is
// charged only for what navigation to that page adds.
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const next = join(web, ".next");
const shell = "[project]/apps/web/src/app/(admin)/layout";
const routes = [
  {
    label: "Inbox",
    manifest: "(admin)/inbox/page_client-reference-manifest.js",
    entry: "[project]/apps/web/src/app/(admin)/inbox/page",
    budgetKb: 60,
  },
  {
    label: "Improvements",
    manifest: "(admin)/improvements/page_client-reference-manifest.js",
    entry: "[project]/apps/web/src/app/(admin)/improvements/page",
    budgetKb: 35,
  },
  {
    label: "Insights",
    manifest: "(admin)/insights/page_client-reference-manifest.js",
    entry: "[project]/apps/web/src/app/(admin)/insights/page",
    budgetKb: 50,
  },
];

function manifestOf(relativePath) {
  const path = join(next, "server", "app", relativePath);
  if (!existsSync(path)) {
    throw new Error(`No production build manifest at ${path}`);
  }
  const source = readFileSync(path, "utf8");
  return JSON.parse(
    source.slice(source.indexOf(" = {") + 3, source.lastIndexOf(";")),
  );
}

let failed = false;
for (const route of routes) {
  const entries = manifestOf(route.manifest).entryJSFiles;
  const shared = new Set(entries[shell] ?? []);
  const chunks = (entries[route.entry] ?? []).filter(
    (chunk) => !shared.has(chunk),
  );
  const gzipBytes = chunks.reduce((total, chunk) => {
    const contents = readFileSync(join(next, chunk));
    return total + gzipSync(contents, { level: 9 }).length;
  }, 0);
  const gzipKb = gzipBytes / 1024;
  const status = gzipKb <= route.budgetKb ? "PASS" : "FAIL";
  console.log(
    `${status} ${route.label}: ${gzipKb.toFixed(1)} KB gzip ` +
      `(budget ${route.budgetKb} KB, ${chunks.length} page chunks)`,
  );
  failed ||= gzipKb > route.budgetKb;
}

if (failed) process.exitCode = 1;
