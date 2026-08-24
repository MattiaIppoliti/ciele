import { glob, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
