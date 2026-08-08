/**
 * A domain entity an admin mutation can touch (#620 — moved here from
 * `apps/web` so operations can declare what they mutated without knowing
 * anything about routes). The web app owns the entity→path table that turns
 * these into `revalidatePath` calls; this package only ever *declares*.
 *
 * Kinds are atomic and composable: an operation reports every entity it
 * affected, and overlapping paths dedupe on the web side.
 */
export type MutatedEntity =
  | { kind: "assistantList" }
  /** One Assistant's config: the dashboard card and the whole editor layout. */
  | { kind: "assistant"; id: string }
  /** An Assistant's Flow list: the editor page that renders the router. */
  | { kind: "flows"; assistantId: string }
  /** Any Assistant-editor sub-resource (knowledge, skills, goals, publish). */
  | { kind: "assistantEditor"; assistantId: string }
  /** The org Help Desk directory. */
  | { kind: "helpDeskList" }
  /** One Help Desk's detail page (channels, ticketing). */
  | { kind: "helpDesk"; id: string }
  /** The AI/org settings page (budget, prompt, provider connections). */
  | { kind: "aiSettings" }
  /** The org members roster. */
  | { kind: "members" }
  /** The org API keys page (#618). */
  | { kind: "apiKeys" }
  /** The operational Alerts page. */
  | { kind: "alerts" }
  /** The Improvements Kanban. */
  | { kind: "improvementList" }
  /** One Improvement's detail page. */
  | { kind: "improvement"; id: string }
  /** The conversation Inbox. */
  | { kind: "inbox" }
  /** The org Entities + Records data page (#663). */
  | { kind: "dataEntities" }
  /** The org-staff data assistant page (#668). */
  | { kind: "dataAssistant" };
