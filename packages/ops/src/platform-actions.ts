import { roleAllowsCapability, type Role } from "@agent-hub/core";
import { z } from "zod";

import * as actionApprovals from "./action-approvals";
import * as applicationImports from "./application-imports";
import * as applications from "./applications";
import * as assistants from "./assistants";
import * as channels from "./channels";
import * as configuration from "./configuration";
import * as crawlers from "./crawlers";
import * as data from "./data";
import * as evaluation from "./evaluation";
import * as flows from "./flows";
import * as flowsAgent from "./flows-agent";
import * as helpDesks from "./help-desks";
import * as improvements from "./improvements";
import * as inbox from "./inbox";
import * as integrations from "./integrations";
import * as knowledge from "./knowledge";
import * as memory from "./memory";
import * as organization from "./organization";
import * as publish from "./publish";
import * as reviews from "./reviews";
import * as routines from "./routines";
import * as teammateGrants from "./teammate-grants";
import * as teammateProvision from "./teammate-provision";
import * as teammateRuntime from "./teammate-runtime";
import * as teammates from "./teammates";
import * as usage from "./usage";
import * as threadPreferences from "./thread-preferences";
import type { MutatedEntity } from "./entities";
import { OperationError, type Operation, type OperationContext } from "./operation";

/**
 * Ciele AI's catalogue: every operation of the admin platform, the same set the
 * console, `/api/v1`, the CLI and the MCP server stand on.
 *
 * Unlike a Teammate's curated catalogue (`teammate-actions.ts`), this one is
 * **derived**: an operation added to any module above is offered on the next
 * deploy, because the thing that bounds Ciele AI is not a list but the chatting
 * Member's own Role. It runs exactly where an API key of theirs would, so the
 * question "may it do this" is always "may they".
 *
 * Two things the Role cannot decide, and `platform-actions.test.ts` pins both:
 *
 * - **Excluded** operations are never offered, whatever the Role. Each family
 *   has a reason a Role check cannot express (see `EXCLUDED_PREFIXES`). This is
 *   a rule about agents, so it lives here, by name.
 * - **Confirmed** operations are the ones that declare `effect:
 *   "consequential"` on themselves. They are offered, and every call stops on
 *   the approval card until the Member says yes. The declaration is required by
 *   the `Operation` type, so an operation added tomorrow cannot run unasked
 *   because nobody thought to list its verb.
 * - A call that **carries a credential** is refused whatever its operation,
 *   because a name cannot tell a help-desk channel's label from its bearer
 *   token (see `credentialIn`).
 */

/** The shape every module exports its operations in, input and output erased. */
export type PlatformOperation = Operation<unknown, unknown>;

const MODULES: Record<string, unknown>[] = [
  actionApprovals,
  applicationImports,
  applications,
  assistants,
  channels,
  configuration,
  crawlers,
  data,
  evaluation,
  flows,
  flowsAgent,
  helpDesks,
  improvements,
  inbox,
  integrations,
  knowledge,
  memory,
  organization,
  publish,
  reviews,
  routines,
  teammateGrants,
  teammateProvision,
  teammateRuntime,
  teammates,
  usage,
  threadPreferences,
];

function isOperation(value: unknown): value is PlatformOperation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PlatformOperation>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.capability === "string" &&
    typeof candidate.run === "function" &&
    typeof candidate.entities === "function" &&
    typeof candidate.effect === "string" &&
    candidate.input instanceof z.ZodType
  );
}

/**
 * Never offered, with the reason each family needs a rule of its own.
 *
 * - Deciding a gate (`approvals.decide`, `reviews.decide`): an agent must not
 *   approve the actions it was stopped on.
 * - Anything that takes a credential as input (API keys, provider keys, SSO,
 *   ticketing, API integrations, crawler keys): the secret would have to be
 *   typed into the chat, and the transcript keeps it. Operations that take one
 *   only optionally (a help-desk channel, a Flow's API request) stay offered,
 *   and `runPlatformOperation` refuses the call that fills the field.
 * - Deleting an API key: the revoked row is the key's audit trail, which is
 *   why the delete is a console button and on no machine route.
 * - Operations that only mean something inside a Teammate's own turn, or that
 *   belong to the Flow Canvas's agent: a Teammate's memory (its own tools and
 *   the Agent layer, which its distillation job writes), referral, the Flows
 *   Agent's lifecycle, provisioning. The Member's own User layer
 *   (`memory.me.write`) stays offered: it is theirs, and every write keeps a
 *   revertable history.
 * - Posting into a channel: a message starts a chain of model turns, which is
 *   why that operation has no machine route anywhere (#778).
 * - Leaving the Organization: not something to do by asking.
 * - Deleting a revoked API key: the row is the key's audit trail, which is why
 *   the delete is a console act with no API, CLI or MCP route (#1007).
 */
const EXCLUDED_PREFIXES = [
  "approvals.decide",
  "reviews.decide",
  "apiKeys.create",
  "apiKeys.delete",
  "providers.create",
  "sso.connection.set",
  "helpDesks.ticketing.connect",
  "apiIntegrations.set",
  "crawlers.set",
  "memory.remember",
  "memory.project.record",
  "teammates.memory.write",
  "teammates.referral.",
  "teammates.provision",
  "flows.agent.",
  "channels.messages.post",
  "members.leave",
  // Personal console triage belongs to the Member, not an agent turn.
  "threads.",
];

export type PlatformOperationPolicy = "excluded" | "confirm" | "run";

/**
 * The exclusion rule and the operation's own declaration, as one answer. A
 * name no module defines is `excluded`: there is nothing to offer, and running
 * it is refused before any confirmation would matter.
 */
export function platformOperationPolicy(name: string): PlatformOperationPolicy {
  if (EXCLUDED_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return "excluded";
  }
  const op = allOperations().find((candidate) => candidate.name === name);
  if (!op) return "excluded";
  return op.effect === "consequential" ? "confirm" : "run";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * Field names that hold a secret in every operation that takes one: a support
 * channel's config, a Flow's `api_request` and webhook auth, a ticketing
 * connection. `key` is only a secret beside `type: "api_key"`, and a header or
 * query value only under a name that says it authenticates.
 */
const CREDENTIAL_KEYS = new Set([
  "apiKey",
  "apiKeyValue",
  "basicPassword",
  "bearerToken",
  "clientSecret",
  "password",
  "secret",
  "token",
]);
const CREDENTIAL_PAIR_NAME = /authorization|api[-_]?key|token|secret|password|cookie/i;

/**
 * The path of the first non-empty credential in a call's input, or null. A
 * blank field is not a credential: the editors send one to mean "keep the
 * stored value".
 */
export function credentialIn(input: unknown, path: string[] = []): string | null {
  if (Array.isArray(input)) {
    for (const [index, item] of input.entries()) {
      const pair = isRecord(item) ? item : null;
      if (
        pair &&
        typeof pair.name === "string" &&
        typeof pair.value === "string" &&
        pair.value !== "" &&
        CREDENTIAL_PAIR_NAME.test(pair.name)
      ) {
        return [...path, String(index), "value"].join(".");
      }
      const found = credentialIn(item, [...path, String(index)]);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(input)) return null;
  for (const [key, value] of Object.entries(input)) {
    const secret =
      CREDENTIAL_KEYS.has(key) || (key === "key" && input.type === "api_key");
    if (secret && typeof value === "string" && value !== "") return [...path, key].join(".");
    const found = credentialIn(value, [...path, key]);
    if (found) return found;
  }
  return null;
}

let everyOperation: PlatformOperation[] | null = null;

/** Every operation the modules export, excluded ones included, by name. */
function allOperations(): PlatformOperation[] {
  if (everyOperation) return everyOperation;
  const byName = new Map<string, PlatformOperation>();
  for (const module of MODULES) {
    for (const value of Object.values(module)) {
      if (isOperation(value)) byName.set(value.name, value);
    }
  }
  everyOperation = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return everyOperation;
}

/**
 * Every operation name the policy is asked about, excluded ones included, so a
 * test can tell a rule that matches a real operation from one that matches a
 * name nobody defined.
 */
export function everyOperationName(): string[] {
  return allOperations().map((op) => op.name);
}

/** Every operation the modules export, excluded ones included, sorted by name. */
export function operationsByName(): readonly PlatformOperation[] {
  return allOperations();
}

/** Every offerable operation, by name, deduplicated across re-exports. */
export function platformOperations(): PlatformOperation[] {
  return allOperations().filter((op) => platformOperationPolicy(op.name) !== "excluded");
}

/** One catalogue row as the model sees it when it lists. */
export interface PlatformOperationSummary {
  name: string;
  capability: string;
  /** True when every call waits for the Member to confirm it. */
  confirm: boolean;
}

/**
 * What this Role may reach, optionally one domain (the name's first segment).
 * A Viewer listing sees only what a Viewer may do, so the model is never
 * offered something it would then be refused.
 */
export function listPlatformOperations(
  role: Role | null,
  domain?: string
): PlatformOperationSummary[] {
  return platformOperations()
    .filter((op) => roleAllowsCapability(role, op.capability))
    .filter((op) => !domain || op.name.split(".")[0] === domain)
    .map((op) => ({
      name: op.name,
      capability: op.capability,
      confirm: platformOperationPolicy(op.name) === "confirm",
    }));
}

/** The domains, for a first listing that fits in one tool result. */
export function platformOperationDomains(role: Role | null): { domain: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const op of listPlatformOperations(role)) {
    const domain = op.name.split(".")[0] ?? op.name;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts].map(([domain, count]) => ({ domain, count }));
}

function findReachable(role: Role | null, name: string): PlatformOperation {
  const op = platformOperations().find((candidate) => candidate.name === name);
  if (!op) {
    throw new OperationError(
      "invalid_input",
      `There is no platform operation called "${name}". List the operations to see the names.`
    );
  }
  if (!roleAllowsCapability(role, op.capability)) {
    throw new OperationError(
      "invalid_input",
      `Your colleague's role does not allow "${name}", so it cannot run for them.`
    );
  }
  return op;
}

/** An operation's input as JSON Schema, so the model can build a valid call. */
export function describePlatformOperation(role: Role | null, name: string) {
  const op = findReachable(role, name);
  return {
    name: op.name,
    capability: op.capability,
    confirm: platformOperationPolicy(op.name) === "confirm",
    input: z.toJSONSchema(op.input, { unrepresentable: "any", io: "input" }),
  };
}

export interface PlatformOperationRun {
  operation: string;
  entities: MutatedEntity[];
  result: unknown;
}

/**
 * Run one platform operation as the Member.
 *
 * The Role check runs here even though listing already filtered by it: listing
 * decides what the model is *offered*, this decides what executes, and a model
 * that names something it was never shown must still be refused. The context is
 * the caller's to build, and it is the Member's own, never a Teammate's.
 */
export async function runPlatformOperation(
  ctx: OperationContext,
  name: string,
  rawInput: unknown
): Promise<PlatformOperationRun> {
  const op = findReachable(ctx.role, name);
  // Checked on the raw call, before parsing strips anything: what matters is
  // that the secret is being asked for through chat, not whether it would land.
  const credential = credentialIn(rawInput);
  if (credential) {
    throw new OperationError(
      "invalid_input",
      `This call carries a credential (${credential}). Credentials are never set through chat, because the transcript keeps them. Ask your colleague to enter it in the console, and run the call again without it.`
    );
  }
  const input = op.input.parse(rawInput ?? {});
  const result = await op.run(ctx, input);
  return { operation: op.name, entities: op.entities(input, result), result };
}
