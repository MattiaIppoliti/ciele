import { HTML_EXTRACT_WASM_BASE64 } from "./html-extract.wasm.generated";

/**
 * The Rust HTML extractor, in-process (map #1111). `native/html-extract` is
 * `htmlToText` and `extractPage` ported to Rust and compiled to WebAssembly.
 * On real pages it was 2.1–2.7× faster than cheerio, with a quarter to half
 * the peak memory, and its output was identical on every page
 * (`html-wasm.test.ts` holds it there).
 *
 * WebAssembly rather than the Rust service: a page can be 5 MB, over a Vercel
 * Function's 4.5 MB request limit, and a network hop would cost more than the
 * parse saves. The module is embedded as base64, so every bundler (Next on
 * Vercel, the self-host image, Desktop, vitest) carries it with no asset to
 * trace.
 *
 * The ABI is hand-written: write UTF-8 into an `alloc`ed block, call the
 * export, read the JSON it left at `result_ptr()`/`result_len()`.
 */

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  html_to_text(ptr: number, len: number): void;
  extract_page(html: number, htmlLen: number, url: number, urlLen: number): void;
  result_ptr(): number;
  result_len(): number;
}

let compiled: WebAssembly.Module | null = null;
let instance: Exports | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function exports(): Exports {
  compiled ??= new WebAssembly.Module(Buffer.from(HTML_EXTRACT_WASM_BASE64, "base64"));
  instance ??= new WebAssembly.Instance(compiled, {}).exports as unknown as Exports;
  return instance;
}

/** Runs one call; a trap discards the instance so the next call starts clean. */
function call<T>(run: (wasm: Exports, put: (value: string) => [number, number]) => void): T {
  const wasm = exports();
  const blocks: [number, number][] = [];
  const put = (value: string): [number, number] => {
    const bytes = encoder.encode(value);
    const ptr = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    blocks.push([ptr, bytes.length]);
    return [ptr, bytes.length];
  };
  try {
    run(wasm, put);
    for (const [ptr, len] of blocks) wasm.dealloc(ptr, len);
    return JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.result_ptr(), wasm.result_len()))) as T;
  } catch (error) {
    instance = null;
    throw error;
  }
}

/** `htmlToText`'s contract, in Rust. */
export function htmlToTextWasm(html: string): { title: string; text: string } {
  return call((wasm, put) => wasm.html_to_text(...put(html)));
}

export interface ExtractedPage {
  page: { url: string; title: string; text: string } | null;
  links: string[];
}

/** `extractPage`'s contract, in Rust. */
export function extractPageWasm(html: string, url: string): ExtractedPage {
  return call((wasm, put) => {
    const [h, hl] = put(html);
    const [u, ul] = put(url);
    wasm.extract_page(h, hl, u, ul);
  });
}
