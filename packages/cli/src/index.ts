import { createInterface } from "node:readline/promises";
import {
  CieleApiError,
  CieleClient,
  DEFAULT_CIELE_BASE_URL,
} from "@ciele/client";
// Explicit .ts extensions: the bin runs this via Node's type stripping,
// where ESM relative specifiers must be fully qualified.
import { fileConfigStore, type ConfigStore } from "./config.ts";
import { table } from "./output.ts";
import { assistants } from "./commands/assistants.ts";
import { flows } from "./commands/flows.ts";
import { collections, faqs, sources } from "./commands/knowledge.ts";
import { publish } from "./commands/publish.ts";
import { conversations, messages } from "./commands/inbox.ts";
import { improvements } from "./commands/improvements.ts";
import { entities, records } from "./commands/entities.ts";
import { memories } from "./commands/memories.ts";
import { sso } from "./commands/sso.ts";
import { helpDesks } from "./commands/help-desks.ts";
import { alerts, goals, skills } from "./commands/configuration.ts";
import { apiKeys, invites, members, organization } from "./commands/organization.ts";
import { apiIntegrations, providers } from "./commands/integrations.ts";
import type { CommandContext } from "./commands/shared.ts";

/** noun → command-group handler; each group owns its verbs (#628). */
const COMMAND_GROUPS: Record<
  string,
  (verb: string | undefined, ctx: CommandContext) => Promise<number>
> = {
  assistants,
  flows,
  collections,
  sources,
  faqs,
  publish,
  conversations,
  messages,
  improvements,
  entities,
  records,
  memories,
  sso,
  "help-desks": helpDesks,
  skills,
  goals,
  alerts,
  organization,
  members,
  invites,
  "api-keys": apiKeys,
  "api-integrations": apiIntegrations,
  providers,
};

/**
 * The `ciele` CLI (#627): noun-verb commands over `@ciele/client`.
 *
 * Credential resolution, in order: `--api-key` flag → `CIELE_API_KEY` env →
 * the config file `ciele login` wrote. Base URL likewise (`--base-url` →
 * `CIELE_BASE_URL` → config → the SaaS) — a self-hosted deployment is one
 * env var away, never a special case.
 *
 * Exit codes: 0 ok · 1 server/unexpected · 2 usage or rejected input ·
 * 3 authentication/authorization.
 */

export const EXIT = { ok: 0, error: 1, usage: 2, auth: 3 } as const;

export interface CliDeps {
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  config: ConfigStore;
  fetchImpl?: typeof fetch;
  /** Interactive secret prompt for `login` without `--key`. */
  promptSecret?: (question: string) => Promise<string>;
}

interface Parsed {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      flags[arg.slice(2)] = argv[++i];
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return { positional, flags };
}

const USAGE = `ciele — manage your Organization from the terminal

Usage: ciele <command> [options]

Commands:
  login [--key <ciele_sk_…>] [--base-url <url>]   Store a key (validated first)
  logout                                          Forget the stored key
  whoami                                          The key's org, role and id
  doctor                                          Verify deployment, API version and key

  assistants list [--limit <n>] [--all]
  assistants get|duplicate <id>
  assistants create --title <t> [--nickname] [--description]
  assistants update <id> [--file patch.json|--title|--nickname|--description|--answering-style]
  assistants delete <id> --yes
  assistants get-entities <id>
  assistants set-entities <id> --ids <entityId,…>
  assistants get-skills <id>
  assistants set-skills <id> --ids <skillId,…>

  flows list <assistantId>
  flows get <id>
  flows create <assistantId> --name <n> [--description] [--file flow.json]
  flows update <id> [--name|--description|--enabled true|false|--file flow.json]
  flows delete <id> --yes
  flows reorder <assistantId> --ids <id,id,…>

  collections list <assistantId>
  sources list <collectionId>
  sources get <id>                                Poll status until it settles
  sources add-text <collectionId> (--text <t> | --file <path>) [--name]
  sources add-url <collectionId> --url <url>
  sources add-file <collectionId> --file <path>
  sources delete <id> --yes
  sources recrawl <id>
  faqs add <collectionId> --question <q> --answer <a>
  faqs import <collectionId> --file <faqs.csv>

  publish status|create <assistantId>
  publish remove <assistantId> --yes
  publish restore <assistantId> <publicationId>

  conversations list [--assistant <id>] [--limit] [--cursor]
  conversations get <id>
  conversations export <id> [<id>…] [--out <file.json>]
  conversations pin|unpin|feedback|delete <id> [...]
  messages feedback <id> --value <-1|0|1>

  improvements list [--limit] [--cursor]
  improvements get <id>
  improvements update <id> [--status|--priority|--assignee|--due|--title|--description|--tags]

  entities list|get|delete [<id>] [--yes]
  entities create --file <entity.json>
  entities update <id> [--name|--description]
  records list <entityId> [--limit] [--offset]
  records query <entityId> --file <query.json>
  records import <entityId> --file <records.csv>

  memories status|enable|disable|subjects
  memories list <subjectId>
  memories delete <memoryId> --yes
  memories wipe <subjectId> --yes

  sso status
  sso identity <claim|none>                      Configure verified SSO claim
  sso validate                                   Revalidate stored credentials

  help-desks list|get|create|update|delete
  help-desks add-channel|update-channel|delete-channel <deskId> [...]
  help-desks reorder-channels <deskId> --ids <id,id,…>
  help-desks connect-servicenow <deskId> --file <credentials.json>
  help-desks disconnect-ticketing <deskId> --yes

  skills list|create|update|delete
  goals list|create|update|delete <assistantId> [...]
  alerts list|resolve [<id>]

  organization get|update
  members list|set-role|remove
  invites list|create|revoke
  api-keys list|create|revoke
  api-integrations get|set|delete <assistantId>
  providers list|create-api-key|create-compatible|create-federated|delete|set-embedding

Global options:
  --json               Machine-readable output
  --api-key <key>      Override the stored/env credential
  --base-url <url>     Target deployment (self-host friendly)

Environment: CIELE_API_KEY, CIELE_BASE_URL (both beat the config file).`;

function str(flag: string | boolean | undefined): string | undefined {
  return typeof flag === "string" ? flag : undefined;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const { positional, flags } = parseArgs(argv);
  const json = flags.json === true;
  const emit = (human: string, data: unknown) =>
    deps.stdout(json ? JSON.stringify(data, null, 2) : human);

  const config = deps.config.load();
  const baseUrl =
    str(flags["base-url"]) ?? deps.env.CIELE_BASE_URL ?? config.baseUrl;
  const resolvedBaseUrl = (baseUrl ?? DEFAULT_CIELE_BASE_URL).replace(/\/+$/, "");
  const apiKey =
    str(flags["api-key"]) ?? deps.env.CIELE_API_KEY ?? config.apiKey;

  const client = (key = apiKey) =>
    new CieleClient({ apiKey: key ?? "", baseUrl, fetch: deps.fetchImpl });

  const [noun, verb, ...rest] = positional;

  try {
    if (!noun || noun === "help" || flags.help === true) {
      deps.stdout(USAGE);
      return EXIT.ok;
    }

    if (noun === "login") {
      let key = str(flags.key);
      if (!key && deps.promptSecret) {
        key = (await deps.promptSecret("Paste your API key (ciele_sk_…): ")).trim();
      }
      if (!key) {
        deps.stderr("login needs a key: pass --key or run interactively");
        return EXIT.usage;
      }
      // Validate before storing — a typo'd key should fail now, not later.
      const identity = await client(key).whoami();
      deps.config.save({ apiKey: key, ...(baseUrl ? { baseUrl } : {}) });
      emit(
        `Logged in to ${identity.organizationId} as role "${identity.role}" (saved to ${deps.config.describe()})`,
        identity
      );
      return EXIT.ok;
    }

    if (noun === "logout") {
      deps.config.clear();
      emit(`Removed ${deps.config.describe()}`, { ok: true });
      return EXIT.ok;
    }

    if (!apiKey) {
      deps.stderr(
        "No API key. Run `ciele login`, or set CIELE_API_KEY (keys are minted in Settings → API Keys)."
      );
      return EXIT.auth;
    }

    if (noun === "whoami") {
      const identity = await client().whoami();
      emit(
        table([identity], [
          { key: "organizationId", header: "Organization" },
          { key: "role", header: "Role" },
          { key: "keyId", header: "Key" },
        ]),
        identity
      );
      return EXIT.ok;
    }

    if (noun === "doctor") {
      const [meta, identity] = await Promise.all([client().meta(), client().whoami()]);
      const result = {
        ok: meta.api === "ciele" && meta.apiVersion === 1,
        baseUrl: resolvedBaseUrl,
        apiVersion: meta.apiVersion,
        serverVersion: meta.serverVersion,
        domains: meta.domains,
        organizationId: identity.organizationId,
        role: identity.role,
        keyId: identity.keyId,
      };
      emit(
        [
          `${result.ok ? "Ready" : "Incompatible"}: ${resolvedBaseUrl}`,
          `API v${meta.apiVersion} · server ${meta.serverVersion}`,
          `Organization ${identity.organizationId} · role ${identity.role}`,
          `Domains: ${meta.domains.join(", ")}`,
        ].join("\n"),
        result
      );
      return result.ok ? EXIT.ok : EXIT.error;
    }

    const group = COMMAND_GROUPS[noun];
    if (group) {
      return await group(verb, { client: client(), flags, rest, emit, deps });
    }

    deps.stderr(`Unknown command "${noun}". Try: ciele help`);
    return EXIT.usage;
  } catch (error) {
    if (error instanceof CieleApiError) {
      deps.stderr(`${error.code}: ${error.message}`);
      if (error.status === 401 || error.status === 403) return EXIT.auth;
      if (error.status >= 400 && error.status < 500) return EXIT.usage;
      return EXIT.error;
    }
    deps.stderr(error instanceof Error ? error.message : String(error));
    return EXIT.error;
  }
}

/** Entry point for bin/ciele.mjs — real stdio, real config file. */
export async function main(argv: string[]): Promise<number> {
  return runCli(argv, {
    env: process.env,
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    config: fileConfigStore(),
    promptSecret: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  });
}
