// The TypeScript side: the real functions from @agent-hub/core, same corpus,
// same output file shape, same timing loop as src/main.rs.
import { readFileSync, writeFileSync } from "node:fs";
import { matchFlow } from "../../../packages/core/src/engine";
import { tokenize } from "../../../packages/core/src/text";
import { htmlToText } from "../../../packages/agent/src/extract";
import { loadHtmlWasm, loadPageWasm } from "./html-wasm";
import { extractPage } from "../../../packages/agent/src/local-crawl";
import type { Flow } from "../../../packages/core/src/types";

const [component, corpusPath, outputPath, iterationsArg] = process.argv.slice(2);
const corpus = JSON.parse(readFileSync(corpusPath!, "utf8")) as {
  flows: Flow[];
  messages: string[];
  pages?: { url: string; html: string }[];
};
const pageWasm = component === "page-wasm" ? await loadPageWasm(process.env.HTML_WASM!) : null;
const iterations = Number(iterationsArg ?? 20);

const wasmHtml = component === "html-wasm" ? await loadHtmlWasm(process.env.HTML_WASM!) : null;

const run = async (messages: string[]): Promise<unknown[]> => {
  if (component === "html") return Promise.all(messages.map((m) => htmlToText(m)));
  if (wasmHtml) return messages.map((m) => wasmHtml(m));
  if (component === "page") return corpus.pages!.map((p) => extractPage(p.html, p.url));
  if (pageWasm) return corpus.pages!.map((p) => pageWasm(p.html, p.url));
  if (component === "tokenize") return messages.map((m) => tokenize(m));
  if (component === "router") return messages.map((m) => matchFlow(m, corpus.flows)?.id ?? null);
  throw new Error(`unknown component ${component}`);
};

corpus.messages ??= (corpus.pages ?? []).map((p) => p.html);
writeFileSync(outputPath!, JSON.stringify(await run(corpus.messages)));
// Warm the JIT the way a long-lived server is warm, then time.
for (let i = 0; i < 5; i++) await run(corpus.messages);
const samples: number[] = [];
for (let i = 0; i < iterations; i++) {
  const started = performance.now();
  await run(corpus.messages);
  samples.push(performance.now() - started);
}
samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)]!;
console.log(JSON.stringify({ side: "ts", component, items: corpus.messages.length, passMedianMs: median, perItemUs: (median * 1000) / corpus.messages.length }));
