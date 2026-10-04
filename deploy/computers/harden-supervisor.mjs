import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Fail closed if the pinned upstream contract changes. Only child authentication
// changes; OpenBot retains ownership of container creation, volumes and lifecycle.
export function hardenSupervisorEnvironment(source) {
  const before =
    "const computerToken = env.COMPUTER_TOKEN?.trim() || undefined;";
  if (source.split(before).length !== 2)
    throw new Error(
      "Pinned OpenBot environment contract changed; review before building.",
    );
  return `import { createHmac } from "node:crypto";\n${source.replace(
    before,
    `const master = env.COMPUTER_TOKEN?.trim();
  if (!master || master.length < 24) throw new Error("COMPUTER_TOKEN must contain at least 24 characters.");
  const computerToken = createHmac("sha256", master).update("ciele-computer:" + botId).digest("hex");`,
  )}`;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const path = process.argv[2];
  if (!path) throw new Error("Pass the pinned supervisor environment.ts path.");
  await writeFile(
    path,
    hardenSupervisorEnvironment(await readFile(path, "utf8")),
  );
}
