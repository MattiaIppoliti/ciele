import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textsOf, toBlocks } from "./mdx-blocks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "../content/docs");
const localeSuffix = /\.(it|es|fr|de)\.mdx$/;

async function englishPages(directory) {
  const files = [];
  for await (const file of glob("**/*.mdx", { cwd: directory })) {
    if (!localeSuffix.test(file)) files.push(path.join(directory, file));
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
