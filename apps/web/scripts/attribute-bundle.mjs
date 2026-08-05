// Module-level attribution of a route's client bundle: which dependency is the
// weight, not just how much weight there is.
//
//   pnpm --filter @agent-hub/web analyze          # writes .next/diagnostics/analyze
//   pnpm --filter @agent-hub/web attribute home
//
// Reads the data `next experimental-analyze -o` emits. Each `chunk_part` carries
// a `size` and a `compressed_size` for one module in one output chunk, so bytes
// can be grouped by where the module came from.
//
// IMPORTANT: `compressed_size` is each module compressed *in isolation*, so the
// column does not sum to the route's real gzip size — a route's parts add up to
// noticeably more than the transferred bytes. Use these numbers for *ratios*
// ("the animated wrappers are 1.7x the lucide glyphs"), and measure-bundle.mjs
// or an A/B build for absolute totals. See docs/runbooks/bundle-measurement.md.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const web = process.env.WEB_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(web, ".next", "diagnostics", "analyze", "data");
const route = process.argv[2] ?? "home";
const topN = Number(process.argv[3] ?? 20);

if (!existsSync(join(dataDir, route, "analyze.data"))) {
  const available = existsSync(dataDir)
    ? readdirSync(dataDir).filter((f) => !f.includes(".")).join(", ")
    : "(none — run `pnpm analyze` first)";
  console.error(`No analyze data for "${route}". Available: ${available}`);
  process.exit(1);
}

/* The .data files are a small binary header followed by JSON, and more frames
   may follow the first object. Scan for the opening brace, then track depth
   (skipping string contents) to find where that first object ends. */
function readFrame(file) {
  const buf = readFileSync(join(dataDir, file));
  const text = buf.slice(buf.indexOf(0x7b)).toString("utf8");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return JSON.parse(text.slice(0, i + 1));
  }
  throw new Error(`Unterminated JSON frame in ${file}`);
}

const data = readFrame(join(route, "analyze.data"));

// `sources` is a tree: each entry holds a leaf name plus its parent's index.
const paths = new Map();
function fullPath(index, seen = new Set()) {
  if (paths.has(index)) return paths.get(index);
  const source = data.sources[index];
  if (!source || seen.has(index)) return "";
  seen.add(index);
  const parent =
    source.parent_source_index != null && source.parent_source_index !== index
      ? fullPath(source.parent_source_index, seen)
      : "";
  const path = parent ? `${parent}/${source.path}` : source.path;
  paths.set(index, path);
  return path;
}

// Client chunks only — the same analyze data also covers the SSR bundle, which
// the browser never downloads.
const isClient = (index) =>
  /\[client-fs\]|\/_next\/static\//.test(data.output_files[index]?.filename ?? "");

// Reconstructed paths can contain doubled separators, so match runs of them.
const seg = (body) => new RegExp(body.replaceAll("/", "[\\\\/]+"));
const BUCKETS = [
  ["animated-icon barrel", (p) => /animated-icon\.tsx/.test(p)],
  [
    "animated icon modules",
    (p) => seg("components/ui/").test(p) && !/animated-icon/.test(p),
  ],
  ["lucide-react icons", (p) => /lucide-react/.test(p)],
  ["motion / framer", (p) => /motion-dom|framer-motion|motion[\\/]+dist/.test(p)],
  ["morphicons", (p) => /morphicons/.test(p)],
  ["react + react-dom", (p) => seg("/(react|react-dom)/").test(p)],
  ["next runtime", (p) => seg("/next/dist/").test(p)],
  ["app source", (p) => seg("apps/web/src/").test(p)],
];

const perModule = new Map();
let totalRaw = 0;
let totalGz = 0;
for (const part of data.chunk_parts) {
  if (!isClient(part.output_file_index)) continue;
  const path = fullPath(part.source_index);
  const entry = perModule.get(path) ?? { raw: 0, gz: 0 };
  entry.raw += part.size;
  entry.gz += part.compressed_size;
  perModule.set(path, entry);
  totalRaw += part.size;
  totalGz += part.compressed_size;
}

const kb = (n) => (n / 1024).toFixed(1);
console.log(
  `\n${route}: ${perModule.size} client modules, ${kb(totalRaw)} KB raw / ` +
    `${kb(totalGz)} KB compressed-per-module (NOT the transferred total)\n`
);

const buckets = new Map();
for (const [path, size] of perModule) {
  const label = BUCKETS.find(([, match]) => match(path))?.[0] ?? "other";
  const bucket = buckets.get(label) ?? { raw: 0, gz: 0, n: 0 };
  bucket.raw += size.raw;
  bucket.gz += size.gz;
  bucket.n++;
  buckets.set(label, bucket);
}
for (const [label, b] of [...buckets].sort((a, z) => z[1].gz - a[1].gz)) {
  console.log(
    `  ${label.padEnd(24)} ${kb(b.raw).padStart(8)} KB raw ${kb(b.gz).padStart(
      8
    )} KB gz  (${String(b.n).padStart(4)} modules, ${((b.gz / totalGz) * 100)
      .toFixed(1)
      .padStart(4)}%)`
  );
}

console.log(`\ntop ${topN} single modules:`);
const strip = /^.*node_modules[\\/]+(\.pnpm[\\/]+[^\\/]+[\\/]+node_modules[\\/]+)?/;
for (const [path, size] of [...perModule]
  .sort((a, z) => z[1].gz - a[1].gz)
  .slice(0, topN)) {
  console.log(
    `  ${kb(size.gz).padStart(7)} KB gz ${kb(size.raw).padStart(9)} KB raw  ` +
      path.replace(strip, "").replaceAll(/[\\/]+/g, "/")
  );
}
console.log();
