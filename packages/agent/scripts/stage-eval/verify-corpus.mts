/**
 * Runs every corpus file through the production extractor (`extractSourceText`,
 * the same triage and parsers an upload goes through) and prints what a
 * question can rely on. Exits 1 when a file is refused or reads as empty.
 *
 *   pnpm --filter @agent-hub/agent exec tsx scripts/stage-eval/verify-corpus.mts
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSourceText } from "../../src/extract";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "corpus");
let failed = 0;
for (const name of readdirSync(DIR).sort()) {
  const bytes = readFileSync(path.join(DIR, name));
  try {
    const { text } = await extractSourceText({ kind: "file", name, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as never);
    console.log(`\n=== ${name}: ${text.length} chars\n${text}`);
  } catch (error) {
    failed += 1;
    console.log(`\n=== ${name}: REFUSED ${(error as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
