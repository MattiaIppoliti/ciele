import type {
  Assistant,
  Flow,
  KnowledgeCollection,
  PublicationConfig,
  SkillSnapshot,
} from "./types";

/**
 * Builds the immutable snapshot a Publish captures (see context.md:
 * Publication). This is the single place the snapshot's field selection
 * lives, which Assistant fields are frozen into the widget's served config,
 * plus the flows and the collection references. Keeping it here means the
 * selection stays in lockstep with PublicationConfig instead of being
 * hand-picked in the publish server action, where a newly-added Assistant
 * field would silently be omitted from every new Publication.
 */
export function buildPublicationConfig(
  assistant: Assistant,
  flows: Flow[],
  collections: KnowledgeCollection[],
  skills: SkillSnapshot[] = []
): PublicationConfig {
  return {
    assistant: {
      id: assistant.id,
      organizationId: assistant.organizationId,
      title: assistant.title,
      nickname: assistant.nickname,
      description: assistant.description,
      avatarUrl: assistant.avatarUrl,
      welcomeMessage: assistant.welcomeMessage,
      aiDisclaimer: assistant.aiDisclaimer,
      suggestedQuestions: assistant.suggestedQuestions,
      quickReplies: assistant.quickReplies,
      answeringStyle: assistant.answeringStyle,
      simplifiedThinking: assistant.simplifiedThinking,
      // Only when set, so a snapshot of an Assistant with none is the object it
      // was before guardrails existed.
      ...(assistant.guardrails?.length ? { guardrails: structuredClone(assistant.guardrails) } : {}),
      chatLauncherEnabled: assistant.chatLauncherEnabled,
      modelProvider: assistant.modelProvider,
      modelId: assistant.modelId,
      // Only when pinned, so a snapshot of an automatic Assistant is the same
      // object it was before sources existed.
      ...(assistant.modelSource ? { modelSource: assistant.modelSource } : {}),
      allowedModels: assistant.allowedModels ?? [],
      attachmentsEnabled: assistant.attachmentsEnabled ?? false,
      ...(assistant.voice ? { voice: structuredClone(assistant.voice) } : {}),
      style: assistant.style,
      allowedDomains: assistant.allowedDomains,
      helpDeskSettings: assistant.helpDeskSettings,
      tools: assistant.tools,
      requireSignIn: assistant.requireSignIn,
    },
    flows,
    collections: collections.map((c) => ({ id: c.id, name: c.name })),
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      prompt: s.prompt,
      starter: s.starter ?? "",
    })),
  };
}
