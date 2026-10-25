# Rust vs TypeScript, component by component

Each component exists twice: the real TypeScript function, imported from its
package, and a Rust port in `src/`. Both run over the same corpus, and a
component only counts if every output is identical. Then both time the same
full passes on the same machine (map #1111).

```sh
node ts/corpus.mjs                       # corpus.json: Flows + 5000 messages
./run.sh tokenize router                 # parity, then timing and max RSS
CORPUS=corpus-html.json ITER=10 ./run.sh html
```

`corpus-html.json` is `{ "messages": [<html page>, …] }` built from pages
saved under `html/` (not checked in). Results land in `results/`.

| Component | Where | Rust | TypeScript | Max RSS Rust / TS |
|---|---|---|---|---|
| `tokenize` | `packages/core/src/text.ts` | 1.2 µs/message | 1.8 µs/message | 6 MB / 111 MB |
| `matchFlow` | `packages/core/src/engine.ts` | 34.8 µs/message | 30.7 µs/message | 5 MB / 81 MB |
| `htmlToText` | `packages/agent/src/extract.ts` | 77 ms / 8.7 MB | 280 ms / 8.7 MB | 94 MB / 986 MB |
| `htmlToText`, Rust as WebAssembly in Node | same | 102 ms / 8.7 MB | 280 ms / 8.7 MB | 221 MB / 941 MB |
| `extractPage`, Rust as WebAssembly in Node | `packages/agent/src/local-crawl.ts` | 164 ms / 12 pages | 359 ms / 12 pages | 244 MB / 540 MB |

Measured 2026-10-23 on an Apple Silicon Mac, Node 22.23 (after a JIT warm-up)
and a release build. `matchFlow` ports the same algorithm, regexes and
re-tokenizing every Flow per message included, and V8 runs that shape faster.
Precomputing each Flow's stems would speed up both sides.

The WebAssembly rows are what production runs: `packages/agent/native/html-extract`
builds the module that `packages/agent/src/html-wasm.ts` loads in-process.
`HTML_WASM=<path to html_extract_wasm.wasm> ./run.sh html-wasm` (corpus
`corpus-html.json`) and `page-wasm` (corpus `corpus-crawl.json`,
`{ "pages": [{ "url", "html" }] }`) time it against cheerio here.
