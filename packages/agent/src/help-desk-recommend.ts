import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Assistant } from "@agent-hub/core";
import type { HistoryMessage } from "./types";

/**
 * "AI recommended help desk" (assistant Help Desks setup): when the runtime
 * offers the escalation chip, it recommends the selected desk whose
 * description best matches the conversation, so the widget opens that desk's
 * channels directly instead of the generic menu.
 *
 * Built once per turn as a lazy, cached closure — several emission sites may
 * ask (escalate-on-ungrounded, watch-tier trust, the suggest_help_desk
 * action) but at most one cheap classifier call runs. Every failure mode
 * (toggle off, no desks, no model, classifier error, hallucinated id)
 * degrades to `null`, which callers render as today's id-less generic chip.
 */
export interface EscalationDeskCandidate {
  id: string;
  name: string;
  description: string;
}

export type HelpDeskRecommender = () => Promise<string | null>;

const RECENT_TURNS = 6;

export function buildHelpDeskRecommender(options: {
  assistant: Assistant;
  desks: EscalationDeskCandidate[];
  /** The cheap classifier model; null degrades to the generic chip. */
  model: LanguageModel | null;
  message: string;
  history: HistoryMessage[];
  recordUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  signal?: AbortSignal;
}): HelpDeskRecommender {
  const { assistant, desks, model, message, history } = options;
  const enabled = assistant.helpDeskSettings?.aiRecommended === true;
  let cached: Promise<string | null> | null = null;

  async function recommend(): Promise<string | null> {
    if (!model) return null;
    const conversation = [
      ...history.slice(-RECENT_TURNS).map((m) => `${m.role}: ${m.text}`),
      `user: ${message}`,
    ].join("\n");
    const catalog = desks
      .map(
        (desk) =>
          `- id: ${desk.id}\n  name: ${desk.name}\n  description: ${desk.description || "(no description)"}`
      )
      .join("\n");
    const { object, usage } = await generateObject({
      model,
      schema: z.object({
        deskId: z
          .string()
          .nullable()
          .describe("The id of the best-matching desk, or null if none fits clearly better than the others"),
      }),
      system:
        "You route a support escalation to the most relevant help desk. Pick the desk whose name/description best matches what the visitor needs. Answer null only when no desk is clearly more relevant.",
      prompt: `Help desks:\n${catalog}\n\nConversation:\n${conversation}`,
      abortSignal: options.signal,
    });
    options.recordUsage?.({
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    return desks.some((desk) => desk.id === object.deskId)
      ? object.deskId
      : null;
  }

  return () => {
    if (!enabled || desks.length === 0) return Promise.resolve(null);
    // One selected desk needs no model call — it's the recommendation.
    if (desks.length === 1) return Promise.resolve(desks[0].id);
    cached ??= recommend().catch(() => null);
    return cached;
  };
}
