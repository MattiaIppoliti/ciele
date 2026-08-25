/**
 * `@ciele/ops`, the operations layer (#620): every admin operation as
 * (context, validated input) → result, declaring its capability and the
 * entities it mutates. The web app's server actions and the /api/v1 routes
 * both execute these; neither surface re-implements behavior.
 *
 * Framework-free: depends on `@agent-hub/core`, `@agent-hub/db` and zod,
 * nothing else. Side effects that need more than the surface's Db go through
 * `OperationContext.ports`, wired per caller.
 */

export type { MutatedEntity } from "./entities";
export { escapeCsvField, parseCsv } from "./csv";
export {
  OperationError,
  defineOperation,
  type Operation,
  type OperationCapability,
  type OperationContext,
  type TeammateActor,
} from "./operation";

// Assistants domain (#620): the extraction pattern later domains follow.
export {
  assistantPatchSchema,
  createAssistantOp,
  deleteAssistantOp,
  duplicateAssistantOp,
  getAssistantOp,
  listAssistantsOp,
  updateAssistantOp,
} from "./assistants";

// Flows domain (#621): the authoritative router, invariants included.
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

// Knowledge domain (#622): sources, FAQs, re-crawl; pipeline via ports.
export {
  addSourceOp,
  createFaqOp,
  deleteSourceOp,
  unlinkSourceOp,
  getSourceOp,
  importFaqsOp,
  createOrgFaqOp,
  getOrgFaqOp,
  importOrgFaqsOp,
  listCollectionsOp,
  listSourceConceptsOp,
  updateOrgFaqOp,
  listOrgFaqsOp,
  listOrgKnowledgeSourcesOp,
  listSourcesOp,
  recrawlSourceOp,
  setDirectAccessOp,
  setSourceLinksOp,
} from "./knowledge";

// Publish domain (#623): immutable Publication snapshots.
export {
  publicationStatusOp,
  publishAssistantOp,
  republishOp,
  unpublishAssistantOp,
} from "./publish";

// Teammates domain (#768): the org's internal AI colleagues. Ownership and
// visibility are enforced here, over the domain package's pure rules.
export {
  createTeammateOp,
  deleteTeammateOp,
  getTeammateOp,
  hideTeammateOp,
  listTeammateThreadOp,
  listTeammatesOp,
  readTeammateConversationOp,
  startReferralOp,
  unhideTeammateOp,
  teammateInputSchema,
  teammatePatchSchema,
  updateTeammateOp,
} from "./teammates";

// Teammate channels (#778): the group thread as an org resource. Capability is
// `member` throughout, because opening a thread is not configuring an agent; the
// visibility rule is membership, and the two oversight reads are the only ones
// that ignore it (and declare `manageMembers` for saying so).
export {
  addChannelMembersOp,
  addChannelTeammatesOp,
  channelInputSchema,
  channelMembersSchema,
  channelPatchSchema,
  channelTeammatesSchema,
  createChannelOp,
  deleteChannelOp,
  getChannelOp,
  listChannelsOp,
  listOrgChannelsOp,
  markChannelReadOp,
  postChannelMessageOp,
  readOrgChannelOp,
  removeChannelMemberOp,
  removeChannelTeammateOp,
  updateChannelOp,
} from "./channels";
export type {
  ChannelSummary,
  ChannelView,
  PostedChannelMessage,
} from "./channels";

// Inbox domain (#624): read-only conversation review.
export {
  deleteConversationOp,
  getConversationOp,
  listInboxConversationsOp,
  readConversationsForExportOp,
  sendConversationFeedbackOp,
  setConversationPinnedOp,
  setMessageFeedbackOp,
} from "./inbox";

// Improvements domain (#625): list / detail / update, plus the Suggested Fix
// lifecycle (#770), whose accept path is the ADR-0017 amendment's one branch.
export {
  acceptSuggestedFixOp,
  dismissSuggestedFixOp,
  triageFeedbackOp,
  type AcceptedSuggestedFix,
  type FeedbackTriageResult,
  getImprovementOp,
  improvementPatchSchema,
  listImprovementsOp,
  proposeSuggestedFixOp,
  updateImprovementOp,
} from "./improvements";

// Routines (#772): recurring unattended runs, governed by the Teammate's own
// ownership rule and capped at five per Teammate.
export {
  createRoutineOp,
  deleteRoutineOp,
  listRoutinesOp,
  routinePatchSchema,
  updateRoutineOp,
} from "./routines";

// Teammate action grants (#770): who grants what, and what a granted domain
// actually lets a Teammate do inside a turn.
export {
  listTeammateGrantsOp,
  readTeammateGrants,
  setTeammateGrantsOp,
  type TeammateGovernance,
} from "./teammate-grants";
export { writingActor } from "./actor";
// Memory documents + Projects (#771): the three layers, their history, and
// the two writes a Teammate performs mid-turn (not grant-gated: acting on the
// console's domains is #770's rows, remembering is what makes it a colleague).
export {
  createProjectOp,
  deleteProjectOp,
  getMyMemoryOp,
  getProjectOp,
  getTeammateMemoryOp,
  listProjectsOp,
  projectPatchSchema,
  recordProjectDecisionOp,
  rememberAboutMemberOp,
  revertMyMemoryOp,
  updateProjectOp,
  writeMyMemoryOp,
  writeProjectDocumentOp,
  writeTeammateMemoryOp,
  type MemoryDocumentView,
} from "./memory";

export {
  TEAMMATE_ACTION_CATALOG,
  runTeammateAction,
  teammateActions,
  teammateMemoryActions,
  type CatalogedOperation,
  type TeammateActionRun,
  type TeammateActionSpec,
} from "./teammate-actions";

export type { OperationPorts } from "./operation";

export {
  connectServiceNowOp,
  createHelpDeskOp,
  createSupportChannelOp,
  deleteHelpDeskOp,
  deleteSupportChannelOp,
  disconnectTicketingIntegrationOp,
  getHelpDeskOp,
  helpDeskInputSchema,
  helpDeskPatchSchema,
  listHelpDesksOp,
  reorderSupportChannelsOp,
  supportChannelInputSchema,
  supportChannelPatchSchema,
  updateHelpDeskOp,
  updateSupportChannelOp,
} from "./help-desks";

export {
  createAssistantGoalOp,
  createSkillOp,
  deleteAssistantGoalOp,
  deleteSkillOp,
  getAssistantSkillsOp,
  goalExpectationsSchema,
  listAlertsOp,
  listAssistantGoalsOp,
  listSkillsOp,
  resolveAlertOp,
  setAssistantSkillsOp,
  skillInputSchema,
  skillPatchSchema,
  updateAssistantGoalOp,
  updateSkillOp,
} from "./configuration";

export {
  createInviteOp,
  createOrgApiKeyOp,
  getOrganizationOp,
  listInvitesOp,
  listMembersOp,
  listOrgApiKeysOp,
  leaveOrganizationOp,
  organizationPatchSchema,
  removeMemberOp,
  revokeInviteOp,
  revokeOrgApiKeyOp,
  updateMemberRoleOp,
  updateOrganizationOp,
} from "./organization";

export {
  apiIntegrationInputSchema,
  createFederatedProviderConnectionOp,
  createOpenAiCompatibleConnectionOp,
  createProviderApiKeyOp,
  deleteApiIntegrationOp,
  deleteProviderConnectionOp,
  disconnectSsoConnectionOp,
  getApiIntegrationOp,
  getSsoConnectionOp,
  listProviderConnectionsOp,
  openAiCompatibleInputSchema,
  setApiIntegrationOp,
  setEmbeddingConnectionOp,
  setSsoConnectionOp,
  ssoConnectionInputSchema,
  type ApiIntegrationView,
  type ProviderConnectionView,
} from "./integrations";

export {
  createEntityOp,
  deleteEntityOp,
  deleteMemoryOp,
  entityInputSchema,
  ENTITY_CSV_MAX_BYTES,
  ENTITY_IMPORT_MAX_ROWS,
  entityPatchSchema,
  entityRecordQuerySchema,
  getEntityOp,
  getAssistantEntitiesOp,
  getMemorySettingsOp,
  getSsoIdentityOp,
  importEntityRecordsOp,
  listEntitiesOp,
  listEntityRecordsOp,
  listMemorySubjectsOp,
  listSubjectMemoriesOp,
  parseEntityCsv,
  queryEntityRecordsOp,
  setMemorySettingsOp,
  setAssistantEntitiesOp,
  setSsoIdentityOp,
  updateEntityOp,
  validateSsoIdentityOp,
  wipeSubjectMemoriesOp,
  type EntityCsvResult,
} from "./data";
