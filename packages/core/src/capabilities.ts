import type { OrgRole, Role } from "./types";
import { roleAllowsCapability } from "./teammate-grants";

/**
 * Custom Roles built from granular Capabilities (map #1164, ADR-0028).
 *
 * A **Capability** is one thing a Member may do, named `area:action`
 * (`flows:edit`, `inbox:operate`). Every Operation declares exactly one, or
 * `member` for the personal operations any Member may run on their own things
 * (notification preferences, favorites, leaving the Organization). A **Role**
 * is a named set of Capabilities; the six built-ins below are the defaults an
 * Organization starts with, and every one but Owner can be edited.
 *
 * Each Capability carries the **tier** it was held at before Roles were
 * editable: the rung of the old ladder (`member`, `operate`, `edit`,
 * `publish`, `manageMembers`, `manageApiKeys`, `changeRoles`). Two things read
 * it, and nothing else should:
 *
 * 1. The **built-in defaults**: a built-in holds a Capability exactly when its
 *    old rung reached that tier. That is what makes the day this ships a day
 *    nobody gains or loses anything.
 * 2. The **RLS tier** of a Role: the highest tier among its Capabilities. RLS
 *    stays rank-based (`private.has_org_role(org, n)`) and sees that tier
 *    through `organization_members.role`, which a trigger keeps equal to it.
 *    RLS is therefore an upper bound and the Operation layer is the exact
 *    check (ADR-0028).
 *
 * The same catalogue is seeded into `private.capability_catalog` by
 * `20261104140000_custom_roles.sql`; `custom-roles.security.test.ts` in
 * `packages/db` keeps the two in step. A new Capability is a row here and a
 * row there, nothing more.
 */

/** The old ladder's rungs, kept as the tier each Capability sits at. */
export type CapabilityTier =
  | "member"
  | "operate"
  | "edit"
  | "publish"
  | "manageMembers"
  | "manageApiKeys"
  | "changeRoles";

/** Where a Role, and therefore a Capability, may be assigned. */
export type CapabilityLevel = "organization" | "assistant";

export interface CapabilityDefinition {
  id: string;
  /** The editor's group heading. */
  bundle: CapabilityBundle;
  label: string;
  description: string;
  tier: CapabilityTier;
  /** Organization always; `assistant` too when it means something on one Assistant. */
  levels: readonly CapabilityLevel[];
  /** Capabilities that must be on for this one to work. */
  requires: readonly string[];
}

export const CAPABILITY_BUNDLES = [
  "Assistants",
  "Flows",
  "Library",
  "Tools",
  "Inbox",
  "Help Desks",
  "Improvements",
  "Insights",
  "Teammates",
  "Projects",
  "Organization",
  "Members and access",
  "Integrations",
] as const;
export type CapabilityBundle = (typeof CAPABILITY_BUNDLES)[number];

const BOTH: readonly CapabilityLevel[] = ["organization", "assistant"];
const ORG: readonly CapabilityLevel[] = ["organization"];

function cap<const Id extends string>(
  id: Id,
  bundle: CapabilityBundle,
  tier: CapabilityTier,
  label: string,
  description: string,
  options: { levels?: readonly CapabilityLevel[]; requires?: readonly string[] } = {}
): CapabilityDefinition & { id: Id } {
  return { id, bundle, tier, label, description, levels: options.levels ?? ORG, requires: options.requires ?? [] };
}

/**
 * The catalogue, derived from Ciele's own Operations (one Capability per
 * thing an Operation domain lets you do), never from features Ciele does not
 * have. Order is display order inside a bundle.
 */
export const CAPABILITY_CATALOG = [
  // Assistants
  cap("assistants:view", "Assistants", "member", "View Assistants", "Open Assistants and read their settings and publication status.", { levels: BOTH }),
  cap("assistants:chat", "Assistants", "member", "Chat with Assistants", "Ask an Assistant questions from the console.", { levels: BOTH, requires: ["assistants:view"] }),
  cap("assistants:edit", "Assistants", "edit", "Create and edit Assistants", "Create, duplicate, import and change Assistant settings and Skills.", { levels: BOTH, requires: ["assistants:view"] }),
  cap("assistants:delete", "Assistants", "publish", "Delete Assistants", "Delete an Assistant and everything it owns.", { levels: BOTH, requires: ["assistants:view"] }),
  cap("assistants:publish", "Assistants", "publish", "Publish Assistants", "Publish, republish and unpublish an Assistant's widget.", { levels: BOTH, requires: ["assistants:view"] }),

  // Flows
  cap("flows:view", "Flows", "member", "View Flows", "Read Flows, their runs and the Flows Agent thread.", { levels: BOTH, requires: ["assistants:view"] }),
  cap("flows:edit", "Flows", "edit", "Create and edit Flows", "Create, change, reorder and draft Flows.", { levels: BOTH, requires: ["flows:view"] }),
  cap("flows:delete", "Flows", "edit", "Delete Flows", "Delete a Flow.", { levels: BOTH, requires: ["flows:view"] }),
  cap("evaluations:run", "Flows", "edit", "Run evaluations", "Create evaluation datasets and start evaluation runs.", { levels: BOTH, requires: ["assistants:view"] }),

  // Library
  cap("knowledge:view", "Library", "member", "View knowledge", "Read Sources, documents, FAQs and search the Library.", { levels: BOTH }),
  cap("knowledge:edit", "Library", "edit", "Add and edit knowledge", "Add Sources and FAQs, link them to Assistants, recrawl and review documents.", { levels: BOTH, requires: ["knowledge:view"] }),
  cap("knowledge:delete", "Library", "edit", "Delete knowledge", "Delete or unlink Sources and forget extracted knowledge.", { levels: BOTH, requires: ["knowledge:view"] }),
  cap("applications:view", "Library", "member", "View Applications", "See connected Applications and what they import.", { requires: ["knowledge:view"] }),
  cap("applications:edit", "Library", "edit", "Manage Application imports", "Create, configure, sync and delete imports from connected Applications.", { requires: ["applications:view"] }),
  cap("applications:connect", "Library", "publish", "Connect Applications", "Connect, reconnect and remove Organization-wide Applications.", { requires: ["applications:view"] }),

  // Tools
  cap("skills:view", "Tools", "member", "View Skills", "Read the Organization's Skills."),
  cap("skills:edit", "Tools", "edit", "Create and edit Skills", "Create, change and delete Skills.", { requires: ["skills:view"] }),
  cap("apiIntegrations:view", "Tools", "member", "View API integrations", "Read an Assistant's API integration and its endpoint catalogue.", { levels: BOTH, requires: ["assistants:view"] }),
  cap("apiIntegrations:edit", "Tools", "edit", "Edit API integrations", "Set, test and remove an Assistant's API integration.", { levels: BOTH, requires: ["apiIntegrations:view"] }),

  // Inbox
  cap("inbox:view", "Inbox", "member", "View conversations", "Read Conversations, their transcripts and the waiting queue.", { levels: BOTH }),
  cap("inbox:triage", "Inbox", "member", "Triage conversations", "Pin Conversations and leave feedback on answers.", { levels: BOTH, requires: ["inbox:view"] }),
  cap("inbox:delete", "Inbox", "member", "Delete conversations", "Delete a Conversation and its transcript.", { levels: BOTH, requires: ["inbox:view"] }),
  cap("inbox:operate", "Inbox", "operate", "Answer Visitors", "Take over, reply to and release Conversations, and set your availability.", { levels: BOTH, requires: ["inbox:view"] }),
  cap("inbox:legalHold", "Inbox", "manageMembers", "Place legal holds", "Keep a Conversation from retention sweeps and deletion.", { requires: ["inbox:view"] }),
  cap("inbox:reasoning", "Inbox", "manageMembers", "Read model reasoning", "See the model's own reasoning in transcripts, which quotes Visitors and knowledge verbatim.", { levels: BOTH, requires: ["inbox:view"] }),
  cap("reviews:decide", "Inbox", "member", "Decide review requests", "Read and decide the human review gates Flows open."),

  // Help Desks
  cap("helpDesks:view", "Help Desks", "member", "View Help Desks", "Read Help Desks, their channels and operators."),
  cap("helpDesks:edit", "Help Desks", "edit", "Manage Help Desks", "Create, change and delete Help Desks, channels, operators and ticketing.", { requires: ["helpDesks:view"] }),
  cap("businessHours:view", "Help Desks", "member", "View business hours", "Read business hours schedules."),
  cap("businessHours:edit", "Help Desks", "edit", "Edit business hours", "Create, change and delete business hours and the default timezone.", { requires: ["businessHours:view"] }),
  cap("quickTexts:view", "Help Desks", "member", "Use Quick Texts", "Read and insert Quick Texts."),
  cap("quickTexts:edit", "Help Desks", "edit", "Edit Quick Texts", "Create, change and delete Quick Texts.", { requires: ["quickTexts:view"] }),

  // Improvements
  cap("improvements:view", "Improvements", "member", "View Improvements", "Read Improvements, their evidence and validations.", { levels: BOTH }),
  cap("improvements:edit", "Improvements", "edit", "Work on Improvements", "Create, update, link, fix, replay and delete Improvements.", { levels: BOTH, requires: ["improvements:view"] }),
  cap("alerts:view", "Improvements", "member", "View Alerts", "Read operational Alerts."),
  cap("alerts:edit", "Improvements", "edit", "Resolve Alerts", "Resolve and update Alerts.", { requires: ["alerts:view"] }),
  cap("goals:view", "Improvements", "member", "View Goals", "Read quality Goals."),
  cap("goals:edit", "Improvements", "edit", "Edit Goals", "Create, change and delete Goals.", { requires: ["goals:view"] }),

  // Insights
  cap("insights:view", "Insights", "member", "View Insights", "Open Insights, Costs and Observability, and request exports."),
  cap("exports:schedule", "Insights", "edit", "Schedule exports", "Create, change and delete scheduled Insights exports.", { requires: ["insights:view"] }),
  cap("usage:view", "Insights", "manageMembers", "View usage and spend", "Read usage meters and spend per Member."),
  cap("audit:view", "Insights", "manageMembers", "View the audit log", "Read and export the audit log."),

  // Teammates
  cap("teammates:view", "Teammates", "member", "View Teammates", "See Teammates, their memory, grants and Routines."),
  cap("teammates:use", "Teammates", "member", "Work with Teammates", "Give feedback to Teammates and accept their referrals.", { requires: ["teammates:view"] }),
  cap("teammates:edit", "Teammates", "edit", "Create and edit Teammates", "Create, change and delete Teammates, their memory and Routines.", { requires: ["teammates:view"] }),
  cap("teammates:grants", "Teammates", "manageMembers", "Grant Teammate actions", "Set what a Teammate may do and how it runs.", { requires: ["teammates:view"] }),
  cap("channels:use", "Teammates", "member", "Use channels", "Create channels, post in them and manage their participants."),
  cap("channels:oversee", "Teammates", "manageMembers", "Oversee channels", "Read every channel in the Organization, including ones you are not in."),
  cap("memories:view", "Teammates", "member", "View Visitor memories", "Read what Assistants remember about Visitors."),
  cap("memories:edit", "Teammates", "edit", "Delete Visitor memories", "Delete a memory or wipe everything remembered about one Visitor.", { requires: ["memories:view"] }),
  cap("memories:settings", "Teammates", "manageMembers", "Configure Visitor memory", "Turn Visitor memory on or off for the Organization.", { requires: ["memories:view"] }),

  // Projects
  cap("projects:view", "Projects", "member", "View Projects and Tasks", "Read Projects, Tasks, files and activity."),
  cap("projects:edit", "Projects", "edit", "Manage Projects and Tasks", "Create, change and delete Projects, Tasks, labels, files and views.", { requires: ["projects:view"] }),
  cap("tasks:comment", "Projects", "member", "Comment on Tasks", "Write, edit and react to Task comments.", { requires: ["projects:view"] }),

  // Organization
  cap("organization:edit", "Organization", "manageMembers", "Edit Organization settings", "Change the name, logo, retention windows, budget and compost settings."),
  cap("providers:manage", "Organization", "manageMembers", "Manage AI providers", "Add and remove Provider Connections and choose the embedding model."),
  cap("crawlers:manage", "Organization", "manageMembers", "Manage crawlers", "Connect and remove website crawler providers."),
  cap("billing:manage", "Organization", "manageMembers", "Manage billing", "Change the plan, payment details and invoices."),
  cap("personalSubscriptions:manage", "Organization", "changeRoles", "Allow personal AI subscriptions", "Let Members run their own Preview and Teammate turns on a personal subscription."),

  // Members and access
  cap("members:view", "Members and access", "edit", "View Members", "See the member roster and each Member's Role."),
  cap("members:manage", "Members and access", "manageMembers", "Manage Members", "Invite and remove Members, change their Role and limit them to some Assistants.", { requires: ["members:view"] }),
  cap("assistants:access", "Members and access", "manageMembers", "Manage Assistant access", "Decide who may open each Assistant, and at which Role.", { requires: ["members:view", "assistants:view"] }),
  cap("roles:manage", "Members and access", "manageMembers", "Manage Roles", "Create, edit, reset and delete Roles.", { requires: ["members:view"] }),
  cap("apiKeys:manage", "Members and access", "manageApiKeys", "Manage API keys", "Create, revoke and delete Organization API keys."),

  // Integrations
  cap("mcpServers:manage", "Integrations", "manageMembers", "Manage MCP servers", "Connect MCP servers and set which of their tools may run."),
  cap("webhooks:manage", "Integrations", "manageMembers", "Manage webhooks", "Create, test and remove outbound webhooks and read their deliveries."),
  cap("sso:manage", "Integrations", "manageMembers", "Manage single sign-on", "Configure the Organization's SSO connection and visitor identity."),
] as const satisfies readonly CapabilityDefinition[];

export type Capability = (typeof CAPABILITY_CATALOG)[number]["id"];

/** What an Operation declares: a Capability, or `member` for a Member's own things. */
export type CapabilityRequirement = Capability | "member";

const BY_ID = new Map<string, CapabilityDefinition>(CAPABILITY_CATALOG.map((entry) => [entry.id, entry]));

export const CAPABILITIES: readonly Capability[] = CAPABILITY_CATALOG.map((entry) => entry.id);

export function isCapability(value: string): value is Capability {
  return BY_ID.has(value);
}

export function capabilityDefinition(id: string): CapabilityDefinition | undefined {
  return BY_ID.get(id);
}

/** The old rung a requirement sits at; `member` for the ungated ones. */
export function capabilityTier(required: CapabilityRequirement): CapabilityTier {
  if (required === "member") return "member";
  return BY_ID.get(required)?.tier ?? "changeRoles";
}

// --- Built-in Roles --------------------------------------------------------

/** The six Roles every Organization starts with. */
export const BUILTIN_ROLE_KEYS = ["owner", "admin", "editor", "support_agent", "viewer", "data_viewer"] as const;
export type BuiltinRoleKey = (typeof BUILTIN_ROLE_KEYS)[number];

export const BUILTIN_ROLE_NAMES: Record<BuiltinRoleKey, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  support_agent: "Support Agent",
  viewer: "Viewer",
  data_viewer: "Data Viewer",
};

export const BUILTIN_ROLE_DESCRIPTIONS: Record<BuiltinRoleKey, string> = {
  owner: "Everything, including ownership and personal AI subscriptions. Cannot be edited.",
  admin: "Manages the Organization, its Members, Roles, API keys and integrations.",
  editor: "Builds and maintains Assistants, Flows, knowledge, Help Desks and Teammates.",
  support_agent: "Reads everything and answers Visitors from the Inbox.",
  viewer: "Reads everything and changes nothing shared.",
  data_viewer: "Reads Insights and the Assistants they report on, nothing else.",
};

/** Data Viewer is the one built-in that is not a rung: a short explicit list. */
const DATA_VIEWER_DEFAULTS: readonly Capability[] = ["assistants:view", "insights:view"];

/**
 * The Capabilities a built-in Role holds by default. Owner holds every
 * Capability; the four ladder Roles hold what their old rung reached, so the
 * migration preserves today's access exactly; Data Viewer is a short list.
 */
export function builtinRoleDefaults(key: BuiltinRoleKey): Capability[] {
  if (key === "owner") return [...CAPABILITIES];
  if (key === "data_viewer") return [...DATA_VIEWER_DEFAULTS];
  return CAPABILITIES.filter((id) => roleAllowsCapability(key, capabilityTier(id)));
}

export function isBuiltinRoleKey(value: string): value is BuiltinRoleKey {
  return (BUILTIN_ROLE_KEYS as readonly string[]).includes(value);
}

/**
 * The ladder Role RLS sees for a set of Capabilities: the highest tier any of
 * them sits at. Owner is never derived; it is the Owner Role's alone.
 */
export function roleTierFor(capabilities: Iterable<string>): Exclude<Role, "owner"> {
  let rank = 1;
  let operates = false;
  for (const id of capabilities) {
    const tier = BY_ID.get(id)?.tier;
    if (!tier) continue;
    if (tier === "operate") operates = true;
    const r = tier === "edit" ? 2 : tier === "member" || tier === "operate" ? 1 : 3;
    if (r > rank) rank = r;
  }
  if (rank >= 3) return "admin";
  if (rank === 2) return "editor";
  return operates ? "support_agent" : "viewer";
}

/** Whether a Capability may be given to a Role other than Owner. */
export function isOwnerOnlyCapability(id: string): boolean {
  return BY_ID.get(id)?.tier === "changeRoles";
}

// --- Dependencies ---------------------------------------------------------

/** The Capability set with everything it relies on turned on too. */
export function withRequiredCapabilities(selected: Iterable<string>): Capability[] {
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id) || !BY_ID.has(id)) return;
    out.add(id);
    for (const required of BY_ID.get(id)!.requires) visit(required);
  };
  for (const id of selected) visit(id);
  return CAPABILITIES.filter((id) => out.has(id));
}

/** Selected Capabilities that rely on `id`, directly or not: what keeps it on. */
export function capabilitiesRelyingOn(id: string, selected: Iterable<string>): Capability[] {
  const chosen = new Set(selected);
  const relies = (candidate: string, seen = new Set<string>()): boolean => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    const requires = BY_ID.get(candidate)?.requires ?? [];
    return requires.includes(id) || requires.some((next) => relies(next, seen));
  };
  return CAPABILITIES.filter((candidate) => candidate !== id && chosen.has(candidate) && relies(candidate));
}

// --- Checking ------------------------------------------------------------

/** Whether a Capability set covers a requirement. `member` is any Member. */
export function capabilitiesAllow(
  capabilities: ReadonlySet<string> | readonly string[] | null | undefined,
  required: CapabilityRequirement
): boolean {
  if (required === "member") return true;
  if (!capabilities) return false;
  return Array.isArray(capabilities)
    ? capabilities.includes(required)
    : (capabilities as ReadonlySet<string>).has(required);
}

/**
 * The Capabilities a ladder Role stands for when no Role row is at hand (a
 * database one migration behind, the demo Db, a test context). Equal to the
 * built-in's defaults, so a missing row never widens or narrows anything.
 */
export function capabilitiesForLadderRole(role: Role | null | undefined): Capability[] {
  if (!role) return [];
  return builtinRoleDefaults(role);
}

/** What one Role may do on one Assistant: only the Capabilities that exist there. */
export function assistantLevelCapabilities(capabilities: Iterable<string>): Capability[] {
  const chosen = new Set(capabilities);
  return CAPABILITIES.filter((id) => chosen.has(id) && BY_ID.get(id)!.levels.includes("assistant"));
}

/** The intersection, for an API key acting at most as its creator may. */
export function intersectCapabilities(a: Iterable<string>, b: Iterable<string>): Capability[] {
  const right = new Set(b);
  const left = new Set(a);
  return CAPABILITIES.filter((id) => left.has(id) && right.has(id));
}

/** Whether a built-in's Capabilities differ from its defaults (an edited built-in). */
export function isEditedBuiltin(key: BuiltinRoleKey, capabilities: Iterable<string>): boolean {
  const defaults = new Set(builtinRoleDefaults(key));
  const current = new Set(capabilities);
  if (defaults.size !== current.size) return true;
  for (const id of defaults) if (!current.has(id)) return true;
  return false;
}

// --- Rows -------------------------------------------------------------------

/** The built-ins an Organization starts with, which assignment levels each offers. */
const BUILTIN_ASSISTANT_LEVEL: Record<BuiltinRoleKey, boolean> = {
  owner: false,
  admin: true,
  editor: true,
  support_agent: false,
  viewer: true,
  data_viewer: false,
};

/**
 * A built-in Role as a row, the way the migration seeds it. The demo Db
 * seeds from this, and a database one migration behind answers with it
 * (ids `builtin:<key>`), so both read like the real table.
 */
export function builtinOrgRole(organizationId: string, key: BuiltinRoleKey, id = `builtin:${key}`): OrgRole {
  const capabilities = builtinRoleDefaults(key);
  return {
    id,
    organizationId,
    key,
    name: BUILTIN_ROLE_NAMES[key],
    description: BUILTIN_ROLE_DESCRIPTIONS[key],
    capabilities,
    organizationLevel: true,
    assistantLevel: BUILTIN_ASSISTANT_LEVEL[key],
    tier: key === "owner" ? "owner" : roleTierFor(capabilities),
    memberCount: 0,
    apiKeyCount: 0,
    inviteCount: 0,
    assistantGrantCount: 0,
    memberDefault: key === "editor",
    assistantDefault: key === "viewer",
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

/** The built-in key a synthesized `builtin:<key>` id stands for, else null. */
export function builtinKeyOfSyntheticId(id: string): BuiltinRoleKey | null {
  const key = id.startsWith("builtin:") ? id.slice("builtin:".length) : "";
  return isBuiltinRoleKey(key) ? key : null;
}

/** Known Capabilities only, in catalogue order, no duplicates. */
export function orderCapabilities(capabilities: Iterable<string>): Capability[] {
  const chosen = new Set(capabilities);
  return CAPABILITIES.filter((id) => chosen.has(id));
}

/** Display order: built-ins in their fixed order, then custom Roles by name. */
export function compareOrgRoles(a: Pick<OrgRole, "key" | "name">, b: Pick<OrgRole, "key" | "name">): number {
  const rank = (role: Pick<OrgRole, "key">) =>
    role.key && isBuiltinRoleKey(role.key) ? BUILTIN_ROLE_KEYS.indexOf(role.key) : BUILTIN_ROLE_KEYS.length;
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}

// --- One Assistant -----------------------------------------------------------

/** A Member's Role on one Assistant, when an `assistant_access` row sets one. */
export interface AssistantRoleOverride {
  /** `denied`, or the tier of the Role on that Assistant. */
  role: "denied" | "viewer" | "editor" | "admin";
  /** The Role's Capabilities when the row names a Role (`role_id`); else the built-in of `role`. */
  capabilities?: readonly string[] | null;
}

const ASSISTANT_LEVEL = new Set<string>(
  CAPABILITY_CATALOG.filter((entry) => entry.levels.includes("assistant")).map((entry) => entry.id)
);

/**
 * What a Member may do on one Assistant (ADR-0028). An Assistant-level Role
 * **replaces** the Organization Role there, for the Assistant-level
 * Capabilities only: an Organization Viewer made Editor of one Assistant
 * edits that Assistant's Flows, and an Admin made Viewer of one reads it.
 * Organization-only Capabilities (Members, API keys, …) stay as they are.
 *
 * - An Owner is never limited.
 * - `denied`, or a Member limited to selected Assistants with no row for this
 *   one, holds none of the Assistant-level Capabilities here.
 * - `ceiling` caps the Assistant-level half too: an API key never acts above
 *   its own Role, whatever its creator's Role on the Assistant is.
 */
export function effectiveAssistantCapabilities(input: {
  base: readonly string[];
  isOwner: boolean;
  scope: "all" | "selected";
  override: AssistantRoleOverride | null;
  ceiling?: readonly string[] | null;
}): Capability[] {
  if (input.isOwner) return orderCapabilities(input.base);
  const organizationPart = input.base.filter((id) => !ASSISTANT_LEVEL.has(id));
  let onAssistant: readonly string[];
  if (input.override) {
    onAssistant = input.override.role === "denied"
      ? []
      : input.override.capabilities ?? builtinRoleDefaults(input.override.role);
  } else {
    onAssistant = input.scope === "selected" ? [] : input.base;
  }
  const ceiling = input.ceiling ? new Set(input.ceiling) : null;
  const scoped = onAssistant.filter((id) => ASSISTANT_LEVEL.has(id) && (!ceiling || ceiling.has(id)));
  return orderCapabilities([...organizationPart, ...scoped]);
}

/** Whether a Capability means something on one Assistant. */
export function isAssistantLevelCapability(id: string): boolean {
  return ASSISTANT_LEVEL.has(id);
}
