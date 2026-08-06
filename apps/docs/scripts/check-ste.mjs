import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textsOf, toBlocks } from "./mdx-blocks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "../content/docs");
const localeSuffix = /\.(it|es|fr|de)\.mdx$/;

async function englishPages(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await englishPages(target)));
    if (entry.isFile() && entry.name.endsWith(".mdx") && !localeSuffix.test(entry.name)) {
      files.push(target);
    }
  }
  return files;
}

function plainText(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`[^`]+`/g, "term")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sentences(value) {
  return plainText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wordCount(value) {
  return value.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

const failures = [];
for (const file of await englishPages(docsRoot)) {
  const source = await readFile(file, "utf8");
  const blocks = toBlocks(source);
  for (const text of textsOf(blocks)) {
    if (text.includes(";")) failures.push(`${path.relative(docsRoot, file)}: semicolon: ${text}`);
    for (const sentence of sentences(text)) {
      const count = wordCount(sentence);
      if (count > 25) {
        failures.push(`${path.relative(docsRoot, file)}: ${count} words: ${sentence}`);
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("ASD-STE100 structural checks passed for English MDX.");
}
