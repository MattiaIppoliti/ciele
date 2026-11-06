import type { Conversation, SourceUsageStats, StoredMessage } from "./types";
import { isProactiveMessage } from "./message";

/** Sources are counted once per answer, irrespective of repeated citation chips. */
function citedSourceIds(content: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const part of content) {
    if (!part || typeof part !== "object" || !("type" in part) || part.type !== "sources" || !("sources" in part) || !Array.isArray(part.sources)) continue;
    for (const source of part.sources) if (source && typeof source === "object" && "sourceId" in source && typeof source.sourceId === "string" && source.sourceId) ids.add(source.sourceId);
  }
  return ids;
}

/** Oracle for the bounded SQL Library report. No message text enters the result. */
export function sourceUsage(input: {
  sourceIds: readonly string[];
  conversations: readonly Pick<Conversation, "id" | "assistantId" | "teammateId" | "subjectType">[];
  messages: readonly Pick<StoredMessage, "id" | "conversationId" | "role" | "feedback" | "content" | "createdAt">[];
  assistants: readonly { id: string; title: string }[];
  now: Date;
}): SourceUsageStats[] {
  const now = input.now.getTime();
  const since30 = now - 30 * 86_400_000;
  const since90 = now - 90 * 86_400_000;
  const conversations = new Map(input.conversations.filter(row => row.assistantId && !row.teammateId && row.subjectType !== "member").map(row => [row.id, row]));
  const assistants = new Map(input.assistants.map(row => [row.id, row.title]));
  const counts = new Map<string, SourceUsageStats>(input.sourceIds.map(sourceId => [sourceId, { sourceId, cited30: 0, positive30: 0, negative30: 0, lastCitedAt: null, unused90: true, assistants: [] } satisfies SourceUsageStats]));
  const byAssistant = new Map<string, Map<string, number>>();
  for (const message of input.messages) {
    const conversation = conversations.get(message.conversationId);
    const time = Date.parse(message.createdAt);
    if (!conversation?.assistantId || message.role !== "assistant" || isProactiveMessage(message.content) || !Number.isFinite(time) || time < since90 || time > now) continue;
    for (const sourceId of citedSourceIds(message.content)) {
      const stats = counts.get(sourceId);
      if (!stats) continue;
      stats.unused90 = false;
      if (time < since30) continue;
      stats.cited30++;
      if (message.feedback === 1) stats.positive30++;
      if (message.feedback === -1) stats.negative30++;
      if (stats.lastCitedAt === null || time > Date.parse(stats.lastCitedAt)) stats.lastCitedAt = new Date(time).toISOString();
      const perAssistant = byAssistant.get(sourceId) ?? new Map<string, number>();
      perAssistant.set(conversation.assistantId, (perAssistant.get(conversation.assistantId) ?? 0) + 1);
      byAssistant.set(sourceId, perAssistant);
    }
  }
  return [...counts.values()].map(stats => ({ ...stats, assistants: [...(byAssistant.get(stats.sourceId) ?? new Map<string, number>())].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, answers]) => ({ id, title: assistants.get(id) ?? "", answers })) }));
}
