/**
 * `@ciele/ops` — the operations layer (#620): every admin operation as
 * (context, validated input) → result, declaring its capability and the
 * entities it mutates. The web app's server actions and the /api/v1 routes
 * both execute these; neither surface re-implements behavior.
 *
 * Framework-free: depends on `@agent-hub/core`, `@agent-hub/db` and zod,
 * nothing else. Side effects that need more than the surface's Db go through
 * `OperationContext.ports`, wired per caller.
 */

export type { MutatedEntity } from "./entities";
export {
  OperationError,
  defineOperation,
  type Operation,
  type OperationCapability,
  type OperationContext,
} from "./operation";

// Assistants domain (#620) — the extraction pattern later domains follow.
export {
  assistantPatchSchema,
  createAssistantOp,
  deleteAssistantOp,
  duplicateAssistantOp,
  getAssistantOp,
  listAssistantsOp,
  updateAssistantOp,
} from "./assistants";

// Flows domain (#621) — the authoritative router, invariants included.
export {
  createFlowOp,
  deleteFlowOp,
  flowInputSchema,
  flowPatchSchema,
  getFlowOp,
  listFlowsOp,
  reorderFlowsOp,
  updateFlowOp,
} from "./flows";

// Knowledge domain (#622) — sources, FAQs, re-crawl; pipeline via ports.
export {
  addSourceOp,
  createFaqOp,
  deleteSourceOp,
  getSourceOp,
  importFaqsOp,
  listCollectionsOp,
  listSourcesOp,
  recrawlSourceOp,
} from "./knowledge";

// Publish domain (#623) — immutable Publication snapshots.
export {
  publicationStatusOp,
  publishAssistantOp,
  republishOp,
  unpublishAssistantOp,
} from "./publish";

// Inbox domain (#624) — read-only conversation review.
export {
  getConversationOp,
  listInboxConversationsOp,
  readConversationsForExportOp,
} from "./inbox";

// Improvements domain (#625) — list / detail / update.
export {
  getImprovementOp,
  improvementPatchSchema,
  listImprovementsOp,
  updateImprovementOp,
} from "./improvements";

export type { OperationPorts } from "./operation";
