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
export { escapeCsvField, parseCsv, recordsToCsv, tableToCsv } from "./csv";
export {
  OperationError,
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
  askAssistantInput,
  askAssistantOp,
  getAssistantOp,
  listAssistantsOp,
  listAssistantsPageOp,
  updateAssistantOp,
} from "./assistants";

// Flows domain (#621): the authoritative router, invariants included.
export {
  createFlowOp,
  deleteFlowOp,
  draftFlowOp,
  flowCatalogOp,
  flowInputSchema,
  flowPatchSchema,
  flowTriggerSchema,
  getFlowOp,
  listFlowsOp,
  listHttpFlowRunsOp,
  proposeFlowOp,
  reorderFlowsOp,
  updateFlowOp,
} from "./flows";

// The Flows Agent (#838): the per-Assistant system Teammate behind the canvas.
export {
  adoptFlowsAgentThreadOp,
  ensureFlowsAgentOp,
  listFlowsAgentThreadOp,
  readFlowsAgentConversationOp,
} from "./flows-agent";

// Knowledge domain (#622): sources, FAQs, re-crawl; pipeline via ports.
export {
  addOrgSourceOp,
  addSourceOp,
  createFaqOp,
  deleteSourceOp,
  deleteSourcesOp,
  unlinkSourceOp,
  unlinkSourcesOp,
  getSourceOp,
  importFaqsOp,
  createOrgFaqOp,
  getOrgFaqOp,
  importOrgFaqsOp,
  extractSourceMemoriesOp,
  getDocumentSummaryOp,
  getSourceDocumentOp,
  listDocumentChunksOp,
  setDocumentExcludedOp,
  setDocumentsExcludedOp,
  listCollectionsOp,
  listDocumentMemoriesOp,
  forgetKnowledgeMemoryOp,
  restoreKnowledgeMemoryOp,
  searchKnowledgeOp,
  listSourceDocumentsOp,
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

// Approvals domain (#958): actions the approval gate stopped, decided by a
// Member. Approving runs the action the row carries, never a re-derived one.
export { decideActionApprovalOp } from "./action-approvals";

// Reviews domain (#841): the Human review gate's requests, listed and decided.
export {
  decideReviewOp,
  getReviewOp,
  listReviewsOp,
} from "./reviews";

// Applications domain (#839): the Organization's Application Connections as
// the Connector action sees them, and re-consent for missing scopes.
export {
  listApplicationConnectionsOp,
  listConnectorActionsOp,
  requestApplicationReconsentOp,
} from "./applications";
export type { ApplicationConnectionView } from "./applications";
export {
  createApplicationImportOp,
  deleteApplicationImportOp,
  listApplicationImportDocumentsOp,
  setApplicationImportAssistantsOp,
  setApplicationImportEnabledOp,
  syncApplicationImportNowOp,
  updateApplicationImportConfigurationOp,
  type ApplicationImportDocumentRow,
} from "./application-imports";

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
export { readableTeammate } from "./teammate-access";

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
  listChannelMentionsOp,
  listChannelsOp,
  listOrgChannelsOp,
  markChannelReadOp,
  postChannelMessageOp,
  readOrgChannelOp,
  removeChannelMemberOp,
  removeChannelTeammateOp,
  updateChannelOp,
} from "./channels";
export type { ChannelMention } from "./channels";

// Inbox domain (#624): read-only conversation review.
export type { InboxConversationDetail } from "./inbox";
export {
  deleteConversationOp,
  getConversationOp,
  getInboxConversationReviewOp,
  getInboxFacetsOp,
  INBOX_SUMMARY_WINDOW_LIMIT,
  listInboxPageOp,
  readConversationsForExportOp,
  readInboxSummaryWindowOp,
  sendConversationFeedbackOp,
  setConversationLegalHoldOp,
  setConversationPinnedOp,
  setMessageFeedbackOp,
} from "./inbox";

// Improvements domain (#625): list / detail / update, plus the Suggested Fix
// lifecycle (#770), whose accept path is the ADR-0017 amendment's one branch.
export {
  acceptSuggestedFixOp,
  dismissSuggestedFixOp,
  getImprovementOp,
  improvementPatchSchema,
  listImprovementsPageOp,
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
  setTeammateGrantsOp,
  type TeammateGovernance,
} from "./teammate-grants";
// Memory documents + Projects (#771): the three layers, their history, and
// the two writes a Teammate performs mid-turn (not grant-gated: acting on the
// console's domains is #770's rows, remembering is what makes it a colleague).
export {
  createProjectOp,
  deleteProjectOp,
  getProjectOp,
  getTeammateMemoryOp,
  listProjectsOp,
  projectPatchSchema,
  revertMyMemoryOp,
  updateProjectOp,
  writeMyMemoryOp,
  writeProjectDocumentOp,
  writeTeammateMemoryOp,
  type MemoryDocumentView,
} from "./memory";

export {
  runTeammateAction,
  teammateActions,
  teammateMemoryActions,
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
  setOrgBudgetOp,
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
  deleteCrawlerConnectionOp,
  setCrawlerConnectionOp,
} from "./crawlers";

export {
  configureEntitySyncOp,
  createEntityOp,
  deleteEntityOp,
  deleteMemoryOp,
  entityInputSchema,
  ENTITY_IMPORT_MAX_ROWS,
  entityPatchSchema,
  entityRecordQuerySchema,
  getEntityOp,
  getAssistantEntitiesOp,
  getMemorySettingsOp,
  getSsoIdentityOp,
  importEntityRecordsOp,
  listEntitiesPageOp,
  listEntityRecordsOp,
  listMemorySubjectsPageOp,
  listSubjectMemoriesOp,
  queryEntityRecordsOp,
  setMemorySettingsOp,
  setAssistantEntitiesOp,
  setSsoIdentityOp,
  updateEntityOp,
  validateSsoIdentityOp,
  wipeSubjectMemoriesOp,
} from "./data";

// The one workflow operation (#773 follow-up): persona + grants + routines.
export { provisionTeammateOp } from "./teammate-provision";

// Usage, read-only (#853): the plan's meters and who spent the window's
// credits. Nothing here mutates and nothing here is a purchase.
export {
  readUsageMetersOp,
  readUsageSpendersOp,
} from "./usage";

// Eval (#992): datasets and synthetic model-comparison runs. The runtime half
// of a run rides the `evaluation` port.
export {
  EVALUATION_RUN_CAP,
  createEvaluationDatasetOp,
  evaluationDatasetSchema,
  evaluationExampleSchema,
  evaluationRunSchema,
  startEvaluationRunOp,
} from "./evaluation";
