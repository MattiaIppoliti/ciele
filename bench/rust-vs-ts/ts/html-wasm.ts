// Loads the htmlToText WebAssembly module (wasm/) and calls it through its
// hand-written ABI: alloc, write UTF-8, html_to_text, read the JSON result.
import { readFileSync } from "node:fs";

type Exports = {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  html_to_text(ptr: number, len: number): void;
  result_ptr(): number;
  result_len(): number;
  extract_page(html: number, htmlLen: number, url: number, urlLen: number): void;
};

export async function loadHtmlWasm(path: string): Promise<(html: string) => { title: string; text: string }> {
  const { instance } = await WebAssembly.instantiate(readFileSync(path), {});
  const wasm = instance.exports as unknown as Exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return (html) => {
    const bytes = encoder.encode(html);
    const ptr = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    wasm.html_to_text(ptr, bytes.length);
    wasm.dealloc(ptr, bytes.length);
    const out = new Uint8Array(wasm.memory.buffer, wasm.result_ptr(), wasm.result_len());
    return JSON.parse(decoder.decode(out)) as { title: string; text: string };
  };
}

export async function loadPageWasm(path: string): Promise<(html: string, url: string) => unknown> {
  const { instance } = await WebAssembly.instantiate(readFileSync(path), {});
  const wasm = instance.exports as unknown as Exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const put = (value: string): [number, number] => {
    const bytes = encoder.encode(value);
    const ptr = wasm.alloc(bytes.length);
    new Uint8Array(wasm.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  };
  return (html, url) => {
    const [h, hl] = put(html);
    const [u, ul] = put(url);
    wasm.extract_page(h, hl, u, ul);
    wasm.dealloc(h, hl);
    wasm.dealloc(u, ul);
    return JSON.parse(decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.result_ptr(), wasm.result_len())));
  };
}
