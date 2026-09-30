import { z, type ZodObject, type ZodRawShape } from "zod";
import { isCieleAi, type Role, type Teammate, type TeammateActionDomain } from "@agent-hub/core";
import type { MutatedEntity } from "./entities";
import { OperationError, type OperationContext, type TeammateActor } from "./operation";
import {
  describePlatformOperation,
  listPlatformOperations,
  platformOperationDomains,
  platformOperationPolicy,
  runPlatformOperation,
} from "./platform-actions";
import {
  runTeammateAction,
  teammateActions,
  teammateMemoryActions,
  type TeammateActionSpec,
} from "./teammate-actions";

/**
 * Every tool one Teammate's turn may call, for both kinds of Teammate, and the
 * one place that answers the three questions a turn needs answered: which
 * tools, under whose authority, and which calls wait for the Member.
 *
 * - An **ordinary Teammate** acts with its own grants under its ceiling
 *   (`teammate-actions.ts`). The Member's Role is carried for attribution and
 *   is not the gate.
 * - **Ciele AI** has no grants. It acts with the chatting Member's own Role
 *   through three platform tools (list, describe, run), and a run of any
 *   operation that declares itself `consequential` waits for the Member.
 *
 * That wait is part of the tool, not a convention of the caller. The turn's
 * approval gate stops such a call before `run`, and the approval replay runs it
 * afterwards with `confirmed: true`; any other caller that reaches `run`
 * without the confirmation is refused, so a new call path cannot skip it.
 *
 * The host supplies the Member's context (the Db the actions run on and its
 * ports) and adapts each tool to its runtime. It decides nothing here.
 */

/** The operation name the approval card and row carry for a platform call. */
export const PLATFORM_RUN_OPERATION = "platform.run";

/**
 * Who is on the other end of the turn, and what their actions run on. The same
 * shape as an `OperationContext` without a Teammate, except that the Role may
 * be unknown: a Routine has no Member, and Ciele AI then has no tools.
 */
export type TeammateToolsetMember = Omit<OperationContext, "role" | "teammate"> & {
  role: Role | null;
};

/** What one call produced. `payload` is for the surface, never the model. */
export interface TeammateToolRun {
  operation: string;
  entities: MutatedEntity[];
  result: unknown;
  payload?: Record<string, unknown>;
}

export interface TeammateTool {
  /** The catalogue name, e.g. `improvements.update` or `platform.run`. */
  operation: string;
  domain: TeammateActionDomain;
  /** Short phrase for the Thinking panel. */
  label: string;
  /** What the model is told the tool does. */
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  /**
   * True when this call must wait for the Member whatever an approval gate
   * would judge. Only Ciele AI's `platform.run` declares it.
   */
  alwaysConfirm?(input: Record<string, unknown>): boolean;
  /** The approval card's label for one call of a tool that stands for many. */
  labelFor?(input: Record<string, unknown>): string;
  /**
   * `confirmed` is the Member's yes on the approval card. A call that
   * `alwaysConfirm` says must wait is refused without it.
   */
  run(
    input: Record<string, unknown>,
    options?: { confirmed?: boolean }
  ): Promise<TeammateToolRun>;
}

export async function teammateToolset(args: {
  teammate: Teammate;
  member: TeammateToolsetMember;
  /**
   * Which Project the decision-writing tool targets, when it is not the one the
   * Teammate is attached to (a channel bound to a Project, #778).
   */
  projectId?: string | null;
}): Promise<TeammateTool[]> {
  const { teammate, member } = args;
  if (isCieleAi(teammate)) return platformTools(member, teammate.name);

  const grants = await member.db.table("teammateGrants").list({ teammateId: teammate.id });
  const actor: TeammateActor = {
    id: teammate.id,
    name: teammate.name,
    ceiling: teammate.capabilityCeiling,
    grants: grants.map((grant) => grant.domain),
    approvalBypass: teammate.approvalBypass,
    projectId: args.projectId === undefined ? teammate.projectId : args.projectId,
  };
  // The memory tools (#771) are not grant-gated, so an ungranted Teammate
  // still has them.
  const specs = [...teammateActions(actor), ...teammateMemoryActions(actor)];
  const ctx: OperationContext = {
    ...member,
    // Carried for the operations that read it for their own reasons, never the
    // gate: a Viewer can ask a granted Teammate to move a board item.
    role: member.role ?? "viewer",
    teammate: actor,
  };
  return specs.map((spec) => grantedTool(ctx, spec));
}

function grantedTool(ctx: OperationContext, spec: TeammateActionSpec): TeammateTool {
  return {
    operation: spec.operation.name,
    domain: spec.domain,
    label: spec.label,
    description: spec.description,
    inputSchema: spec.operation.input as ZodObject<ZodRawShape>,
    run: async (input) => {
      const outcome = await runTeammateAction(ctx, spec.operation.name, input);
      return {
        operation: outcome.operation,
        entities: outcome.entities,
        result: outcome.result,
        payload: spec.clientPayload?.(outcome.result),
      };
    },
  };
}

const runInput = z.object({
  name: z.string().min(1).describe("The platform operation, e.g. \"assistants.update\"."),
  input: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("The operation's input, shaped by its description."),
});

const waitsForMember = (input: Record<string, unknown>) =>
  platformOperationPolicy(String(input.name ?? "")) === "confirm";

/**
 * Ciele AI's three tools. No Member or no Role means no tools: there is nobody
 * whose permissions they could act with.
 *
 * The Member's Role decides what runs, but the model is still the author, so
 * `agentAuthor` makes a fix it accepts land `machine-confirmed`, signed by
 * Ciele AI, and never `human-reviewed`.
 */
function platformTools(member: TeammateToolsetMember, authorName: string): TeammateTool[] {
  const role = member.role;
  if (!member.userId || !role) return [];
  const ctx: OperationContext = { ...member, role, agentAuthor: authorName };

  return [
    {
      operation: "platform.list",
      domain: "platform",
      label: "Looking through the platform",
      description:
        "List what you can do on the Ciele admin platform for this colleague. Without a domain it returns the domains and how many operations each has; with one it returns that domain's operation names, and whether each waits for confirmation.",
      inputSchema: z.object({
        domain: z
          .string()
          .optional()
          .describe("A domain from the first listing, e.g. \"assistants\" or \"inbox\"."),
      }),
      run: async (input) => {
        const domain = typeof input.domain === "string" ? input.domain : undefined;
        return {
          operation: "platform.list",
          entities: [],
          result: domain ? listPlatformOperations(role, domain) : platformOperationDomains(role),
        };
      },
    },
    {
      operation: "platform.describe",
      domain: "platform",
      label: "Reading how an operation works",
      description:
        "Describe one platform operation: its input as JSON Schema, the role it needs, and whether it waits for confirmation. Describe an operation before running it for the first time.",
      inputSchema: z.object({
        name: z.string().min(1).describe("The operation name from the listing."),
      }),
      run: async (input) => ({
        operation: "platform.describe",
        entities: [],
        result: describePlatformOperation(role, String(input.name)),
      }),
    },
    {
      operation: PLATFORM_RUN_OPERATION,
      domain: "platform",
      label: "Working in the platform",
      description:
        "Run one platform operation for this colleague, with their permissions. Operations that remove, withdraw, publish, change access or spend money wait for them to confirm on a card. Never put a password, token or API key in the input: a call that carries one is refused, and your colleague enters it in the console instead.",
      inputSchema: runInput,
      alwaysConfirm: waitsForMember,
      labelFor: (input) => `Run ${String(input.name ?? "a platform operation")}`,
      run: async (rawInput, options) => {
        const input = runInput.parse(rawInput);
        if (waitsForMember(input) && !options?.confirmed) {
          throw new OperationError(
            "conflict",
            `"${input.name}" waits for your colleague to confirm it on a card, and they have not.`
          );
        }
        return runPlatformOperation(ctx, input.name, input.input);
      },
    },
  ];
}
