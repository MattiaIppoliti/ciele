import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_V1_ENDPOINTS } from "@/lib/api-v1/openapi";
import { DOMAIN_PRESENTATION } from "./domains";

/**
 * CLI fidelity (#754): the panel must not teach a command that errors.
 *
 * The `cli` templates in the contract registry are hand-authored prose about
 * another package. `@ciele/cli` is deliberately *not* declarative: every group
 * is a `switch (verb)` reading `ctx.flags` with inline usage strings, so this
 * reads its sources rather than importing a manifest that does not exist. Reading
 * rather than importing also keeps `apps/web` from depending on the CLI.
 *
 * Flags are collected per command **group**, not per verb: a group's shared
 * helper (`fromFileAndFlags` in the Flows group, for instance) reads flags for
 * several verbs at once, so per-verb scoping would fail on correct snippets. The
 * drift this catches is a renamed or deleted flag, which is the realistic one.
 */

const CLI_SRC = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "cli",
  "src"
);

/** noun → the module its handler lives in. */
function commandGroupFiles(): Map<string, string> {
  const index = readFileSync(join(CLI_SRC, "index.ts"), "utf8");

  // import { collections, faqs, sources } from "./commands/knowledge.ts";
  const identifierFile = new Map<string, string>();
  for (const [, names, file] of index.matchAll(
    /import \{([^}]+)\} from "\.\/commands\/([\w-]+)\.ts"/g
  )) {
    for (const name of names.split(",").map((part) => part.trim())) {
      if (name) identifierFile.set(name, join(CLI_SRC, "commands", `${file}.ts`));
    }
  }

  const block = /const COMMAND_GROUPS[\s\S]*?\n\};/.exec(index)?.[0] ?? "";
  const groups = new Map<string, string>();
  for (const line of block.split("\n")) {
    // Either `flows,` or `"help-desks": helpDesks,`
    const shorthand = /^\s{2}([a-zA-Z]\w*),\s*$/.exec(line);
    const renamed = /^\s{2}"([\w-]+)":\s*([a-zA-Z]\w*),\s*$/.exec(line);
    const noun = shorthand?.[1] ?? renamed?.[1];
    const identifier = shorthand?.[1] ?? renamed?.[2];
    if (!noun || !identifier) continue;
    const file = identifierFile.get(identifier);
    if (file) groups.set(noun, file);
  }
  return groups;
}

interface GroupSurface {
  verbs: Set<string>;
  flags: Set<string>;
}

function groupSurface(file: string): GroupSurface {
  const text = readFileSync(file, "utf8");
  return {
    verbs: new Set([...text.matchAll(/case "([\w-]+)":/g)].map(([, verb]) => verb)),
    flags: new Set([...text.matchAll(/flags\.(\w+)/g)].map(([, flag]) => flag)),
  };
}

/** `--dry-run` in a snippet is `flags["dryRun"]` in the CLI. */
function flagProperty(flag: string): string {
  return flag.replace(/-(\w)/g, (_match, letter: string) => letter.toUpperCase());
}

const GROUPS = commandGroupFiles();

const templates = API_V1_ENDPOINTS.filter(
  (endpoint) => endpoint.cli
).map((endpoint) => ({
  id: `${endpoint.method} ${endpoint.path}`,
  cli: endpoint.cli as string,
}));

describe("CLI snippets name real commands", () => {
  it("finds the CLI's command groups to check against", () => {
    // A rename in the CLI that this parser cannot follow would silently pass
    // every other assertion in this file.
    expect(GROUPS.size).toBeGreaterThan(15);
    expect(GROUPS.get("flows")).toBeTruthy();
    expect(GROUPS.get("help-desks")).toBeTruthy();
  });

  it("starts every snippet with `ciele <noun> <verb>`", () => {
    const malformed = templates
      .filter(({ cli }) => !/^ciele [\w-]+ [\w-]+/.test(cli))
      .map(({ id }) => id);
    expect(malformed).toEqual([]);
  });

  it("uses a noun the CLI dispatches", () => {
    const unknown = templates
      .map(({ id, cli }) => ({ id, noun: cli.split(" ")[1] }))
      .filter(({ noun }) => !GROUPS.has(noun))
      .map(({ id, noun }) => `${id}: no CLI command group "${noun}"`);
    expect(unknown).toEqual([]);
  });

  it("uses a verb that noun's group handles", () => {
    const unknown: string[] = [];
    for (const { id, cli } of templates) {
      const [, noun, verb] = cli.split(" ");
      const file = GROUPS.get(noun);
      if (!file) continue;
      if (!groupSurface(file).verbs.has(verb)) {
        unknown.push(`${id}: \`ciele ${noun}\` has no verb "${verb}"`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("only passes flags that group actually reads", () => {
    const unread: string[] = [];
    for (const { id, cli } of templates) {
      const noun = cli.split(" ")[1];
      const file = GROUPS.get(noun);
      if (!file) continue;
      const { flags } = groupSurface(file);
      for (const [, flag] of cli.matchAll(/--([a-z][\w-]*)/g)) {
        if (!flags.has(flagProperty(flag))) {
          unread.push(`${id}: \`ciele ${noun}\` never reads --${flag}`);
        }
      }
    }
    expect(unread).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* MCP fidelity                                                              */
/* -------------------------------------------------------------------------- */

const MCP_TOOLS_FILE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "mcp",
  "src",
  "tools.ts"
);

interface ToolSurface {
  actions: Set<string>;
  args: Set<string>;
}

/**
 * The 14 coarse MCP tools, read from their source. Each takes `{ action, … }`,
 * so a template naming an action the tool does not have, or an argument it never
 * reads, would send a call that fails at the server.
 */
function mcpTools(): Map<string, ToolSurface> {
  const text = readFileSync(MCP_TOOLS_FILE, "utf8");
  const tools = new Map<string, ToolSurface>();
  const blocks = text.split(/\n {6}name: "/);
  for (const block of blocks.slice(1)) {
    const name = /^([\w]+)"/.exec(block)?.[1];
    if (!name) continue;
    const schema = block.slice(0, block.indexOf("\n      mutates"));
    const enumBlock = /action: z\.enum\(\[([\s\S]*?)\]\)/.exec(schema)?.[1] ?? "";
    tools.set(name, {
      actions: new Set(
        [...enumBlock.matchAll(/"([\w]+)"/g)].map(([, action]) => action)
      ),
      args: new Set([
        "action",
        // `z\b`, not `z\.`: a multi-line zod chain puts the first method on
        // the next line (`assistantIds: z` then `.array(...)`), and missing those
        // would fail correct templates.
        ...[...schema.matchAll(/\n {8}(\w+): z\b/g)].map(([, key]) => key),
      ]),
    });
  }
  return tools;
}

const TOOLS = mcpTools();

const mcpTemplates = API_V1_ENDPOINTS.filter((endpoint) => endpoint.mcp).map(
  (endpoint) => ({
    id: `${endpoint.method} ${endpoint.path}`,
    mcp: endpoint.mcp as string,
    tool: endpoint.domain
      ? DOMAIN_PRESENTATION[endpoint.domain]?.mcpTool
      : undefined,
  })
);

describe("MCP snippets name a real tool call", () => {
  it("finds the tool definitions to check against", () => {
    expect(TOOLS.size).toBeGreaterThan(10);
    expect(TOOLS.get("manage_flows")?.actions.has("reorder")).toBe(true);
  });

  it("parses as JSON with a string action", () => {
    const broken = mcpTemplates
      .filter(({ mcp }) => {
        try {
          const args = JSON.parse(mcp) as { action?: unknown };
          return typeof args.action !== "string";
        } catch {
          return true;
        }
      })
      .map(({ id }) => id);
    expect(broken).toEqual([]);
  });

  it("belongs to a domain whose tool exists", () => {
    const orphaned = mcpTemplates
      .filter(({ tool }) => !tool || !TOOLS.has(tool))
      .map(({ id, tool }) => `${id}: unknown tool ${tool ?? "(none)"}`);
    expect(orphaned).toEqual([]);
  });

  it("names an action that tool accepts", () => {
    const wrong: string[] = [];
    for (const { id, mcp, tool } of mcpTemplates) {
      const surface = tool ? TOOLS.get(tool) : undefined;
      if (!surface) continue;
      const { action } = JSON.parse(mcp) as { action: string };
      if (!surface.actions.has(action)) {
        wrong.push(`${id}: ${tool} has no action "${action}"`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("only passes arguments that tool declares", () => {
    const wrong: string[] = [];
    for (const { id, mcp, tool } of mcpTemplates) {
      const surface = tool ? TOOLS.get(tool) : undefined;
      if (!surface) continue;
      for (const key of Object.keys(JSON.parse(mcp) as Record<string, unknown>)) {
        if (!surface.args.has(key)) {
          wrong.push(`${id}: ${tool} never reads "${key}"`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
