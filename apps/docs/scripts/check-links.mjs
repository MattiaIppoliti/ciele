import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function routeFor(file) {
  const relative = path.relative(docsRoot, file).replaceAll("\\", "/");
  const parts = relative.replace(/\.mdx$/, "").split("/").filter((part) => !/^\(.+\)$/.test(part));
  if (parts.at(-1) === "index") parts.pop();
  return `/${parts.join("/")}` || "/";
}

const files = await englishPages(docsRoot);
const routes = new Set(files.map(routeFor));
const failures = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(/\[[^\]]+\]\((\/[^)#?]*)(?:[?#][^)]*)?\)/g)) {
    const target = match[1].replace(/\/$/, "") || "/";
    if (!routes.has(target)) {
      failures.push(`${path.relative(docsRoot, file)}: ${match[1]}`);
    }
  }
  for (const match of source.matchAll(/href=["'](\/[^"'#?]*)(?:[?#][^"']*)?["']/g)) {
    const target = match[1].replace(/\/$/, "") || "/";
    if (!routes.has(target)) {
      failures.push(`${path.relative(docsRoot, file)}: ${match[1]}`);
    }
  }
}

if (failures.length) {
  console.error(`Broken internal documentation links:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Internal links passed for ${files.length} English pages.`);
}
