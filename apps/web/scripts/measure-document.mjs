// Document size per prerendered route: the HTML itself, and the RSC payload
// inlined in it.
//
// Why this exists beside measure-bundle.mjs: that one weighs client JS, the
// <script src> tags a visitor downloads. Neither it nor check-admin-bundle.mjs
// looks at the document, and the document is where a shared cost hides. The
// browser cannot start on CSS, JS, images or fonts until it has parsed the
// HTML, and React has to walk the whole flight payload to hydrate, so a heavy
// thing in a boundary every route inherits is paid 32 times over and shows up
// in neither existing gate.
//
// Two real cases, both found by this script and both fixed:
//   - app/not-found.tsx drew 50 localized prompt cards. Next serializes a
//     not-found boundary into the payload of EVERY route beneath it, so that
//     was 40 kB of every document, twice over, and 42.6 kB of /assistants'
//     58.9 kB payload, refetched on every soft navigation, to draw a page
//     nobody was looking at. Behind a client boundary it is a module
//     reference.
//   - CloudCallout handed CloudAvatar a ~17 kB SVG string as a prop, twice
//     (one instance per breakpoint, the other display:none). Each copy cost
//     the string once in the payload and once in the rendered HTML: ~67 kB
//     per marketing document for a decorative mascot.
//
//   pnpm --filter @agent-hub/web build
//   pnpm --filter @agent-hub/web measure:document          # full table
//   node scripts/measure-document.mjs --check              # budgets only
//
// Sizes are of the DECODED payload, which is what React parses; the escaped
// form sitting in the HTML runs about 10% larger. Only statically prerendered
// routes appear, a dynamic route emits no HTML at build time, but the shared
// cost this catches is shared with the dynamic routes too: the boundary sits
// in the same layout tree.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const appDir = join(web, ".next", "server", "app");
const checkOnly = process.argv.includes("--check");

if (!existsSync(appDir)) {
  console.error(`No build found at ${appDir}. Run \`next build\` first.`);
  process.exit(1);
}

/**
 * The three budgets.
 *
 * Deliberately derived numbers rather than a route-by-route table: a table of
 * 32 routes is a table nobody updates, and the two regressions above were not
 * one page getting fat. `total` is what catches a shared cost, because a
 * boundary tax multiplies by the number of documents. `document` catches one
 * page going wrong on its own. `row` catches the specific mistake of handing a
 * client component a payload instead of a key, and it is the sharpest of the
 * three: a 17 kB string prop fails it the moment it lands.
 *
 * The raw HTML size is printed but NOT gated. 21 of the 32 documents sit above
 * Next's 128 kB warning threshold and the bytes are real marketing copy, so a
 * passing budget would have to start above 210 kB, which gates nothing. Watch
 * the column, gate the payload.
 */
const BUDGETS = {
  // Vercel's current 30-document build is 0.9 KB above the rounded 1,600 KB
  // target; keep a small tolerance for that aggregate budget. It was 2 KB
  // until the console shell's slots and rail sizing moved into their own
  // modules (#1006-#1010 review): the flight rows are byte-identical, but each
  // admin document's client references now list a few more chunk files, about
  // 0.6 KB across five documents. `document` and `row` still gate real payload.
  total: 1606 * 1024,
  document: 96 * 1024,
  row: 8 * 1024,
  // The component library adds one static document per reusable family.
  // Give those small documents their own 20 KB ceiling and count-scaled
  // aggregate, while preserving the existing application's 1,606 KB gate.
  catalogDocument: 20 * 1024,
};

// An intercepting route (`(.)settings`, `(..)x`, `(..)(..)x`) is prerendered to its own
// HTML file, but no browser ever receives it as a document: Next serves it
// only on a client-side navigation, as flight data under the page already
// open, and a hard load of the same URL renders the real route, which is
// counted on its own. Charging it here would bill each intercepted page twice.
const INTERCEPTED = /^\(\.{1,3}\)/;

function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (INTERCEPTED.test(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(path, out);
    else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out;
}

/** Everything Next pushed into `__next_f`: the flight payload, decoded. */
function flightPayload(html) {
  let payload = "";
  for (const match of html.matchAll(
    /self\.__next_f\.push\(\[1,\s*("[\s\S]*?")\]\)<\/script>/g
  )) {
    // The first push carries a bootstrap marker rather than a string chunk.
    try {
      payload += JSON.parse(match[1]);
    } catch {
      /* not a string chunk */
    }
  }
  return payload;
}

const rows = [];
for (const path of htmlFiles(appDir)) {
  const html = readFileSync(path, "utf8");
  const flight = flightPayload(html);
  if (!flight) continue;
  const widest = flight
    .split("\n")
    .reduce((worst, row) => (row.length > worst.length ? row : worst), "");
  rows.push({
    route: "/" + relative(appDir, path).replace(/\.html$/, "").split(sep).join("/"),
    raw: Buffer.byteLength(html, "utf8"),
    gz: gzipSync(html, { level: 9 }).length,
    flight: Buffer.byteLength(flight, "utf8"),
    widestRow: Buffer.byteLength(widest, "utf8"),
    // A row is `<id>:<payload>`; the id is all the label we need to find it.
    widestRowId: widest.slice(0, widest.indexOf(":") + 1),
  });
}

const kb = (n) => (n / 1024).toFixed(1);

// A build with no prerendered document leaves nothing to weigh, and the
// budgets below would reduce an empty array. Loud rather than skipped: if the
// whole surface went dynamic, the gate should be re-thought, not quietly pass.
if (rows.length === 0) {
  console.error(
    `No prerendered document under ${appDir} carries an RSC payload.` +
      " Either the build is incomplete or every route is now dynamic."
  );
  process.exit(1);
}

rows.sort((a, b) => b.flight - a.flight);

if (!checkOnly) {
  console.log(
    "  HTML raw     gzip   RSC payload  share  widest row  route"
  );
  for (const row of rows) {
    console.log(
      `${kb(row.raw).padStart(8)} kB ${kb(row.gz).padStart(7)} kB ` +
        `${kb(row.flight).padStart(9)} kB ${String(Math.round((row.flight / row.raw) * 100)).padStart(5)}% ` +
        `${kb(row.widestRow).padStart(9)} kB  ${row.route}` +
        (row.raw > 128 * 1024 ? "  (over Next's 128 kB HTML warning)" : "")
    );
  }
  console.log();
}

const catalogRows = rows.filter((row) => row.route === "/components" || row.route.startsWith("/components/"));
const applicationRows = rows.filter((row) => !catalogRows.includes(row));
const total = applicationRows.reduce((n, row) => n + row.flight, 0);
const worstDocument = rows[0];
const worstRow = rows.reduce((a, b) => (b.widestRow > a.widestRow ? b : a));

const checks = [
  {
    label: `RSC payload across ${applicationRows.length} application documents`,
    value: total,
    budget: BUDGETS.total,
    detail: "a boundary every route inherits is charged once per document",
  },
  {
    label: `Largest document payload (${worstDocument.route})`,
    value: worstDocument.flight,
    budget: BUDGETS.document,
    detail: "one page carrying more than the rest",
  },
  {
    label: `Largest single row (${worstRow.route} ${worstRow.widestRowId})`,
    value: worstRow.widestRow,
    budget: BUDGETS.row,
    detail: "usually a payload handed to a client component instead of a key",
  },
];

if (catalogRows.length > 0) {
  const worstCatalog = catalogRows[0];
  checks.push({
    label: `Component library payload across ${catalogRows.length} documents`,
    value: catalogRows.reduce((n, row) => n + row.flight, 0),
    budget: catalogRows.length * BUDGETS.catalogDocument,
    detail: "the component library's boundary cost grows with its family count",
  }, {
    label: `Largest component document (${worstCatalog.route})`,
    value: worstCatalog.flight,
    budget: BUDGETS.catalogDocument,
    detail: "component pages should carry metadata, while previews and source load separately",
  });
}

let failed = false;
for (const check of checks) {
  const ok = check.value <= check.budget;
  failed ||= !ok;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${check.label}: ${kb(check.value)} KB ` +
      `(budget ${kb(check.budget)} KB)${ok ? "" : ` — ${check.detail}`}`
  );
}

if (failed) {
  console.error(
    "\nDocument budget exceeded. `pnpm --filter @agent-hub/web measure:document`" +
      " prints the per-route table; the usual cause is something heavy in a" +
      " shared boundary (layout, not-found, error) or a string passed as a prop."
  );
  process.exit(1);
}
