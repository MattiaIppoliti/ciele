import { generateObject, streamText } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Assistant, FlowAction, FlowActionSettings } from "@agent-hub/core";
import { DEFAULT_BASIC_REPLY, externalLinkUrl } from "@agent-hub/core";
import type { ChatReplyPart } from "./types";
import { buildToolset } from "./tools";
import { createApiResponseStore } from "./api-catalog-tools";
import { resolveTemplate } from "./template";
import { executeApiRequest, extractApiJsonPaths } from "./api-request";
import { emailTransportConfigured } from "./email";
import {
  dedupSources,
  resolveAnsweringStyle,
  runAgenticSearch,
  type FlowStyleContext,
} from "./agentic-search";
import type { ActionContext, ActionHandler } from "./types";
import { errorMessageOf } from "./telemetry";
import { usageTotals } from "./usage";

/**
 * Flow Action handlers: one Adapter per action, dispatched by the live
 * runtime through ACTION_HANDLERS (see engine.ts). Each handler emits its own wire
 * events via `ctx.emit`, returns the reply parts (for persistence), and may
 * request deferred effects or halt the flow. This is the single home for
 * "what a Flow Action does": adding an action is one Adapter here, not edits
 * across two engines. See docs/ARCHITECTURE.md §5 and ADR-0003.
 *
 * The deterministic demo engine (packages/core/src/engine.ts) mirrors only the
 * pure subset. The live no-provider path still dispatches this registry so
 * HTTP/effect actions work and Search knowledge can use lexical retrieval.
 */

/**
 * Turns of history the courtesy reply sees. Enough for "thanks" to read as a
 * reply to the answer above it; short enough that a greeting never re-pays for
 * the whole conversation.
 */
const BASIC_REPLY_HISTORY = 4;

export const contactLabel = (assistant: Assistant): string =>
  assistant.helpDeskSettings?.contactButtonLabel?.trim() || "Contact support";

// ── Handlers ────────────────────────────────────────────────────────────────

/** Verbatim custom message, never model-rewritten (runtime invariant). */
const customMessage: ActionHandler = async ({ flow, emit }) => {
  const part: ChatReplyPart = {
    type: "text",
    action: "custom_message",
    text:
      (flow.customMessage ?? "").trim() ||
      `(This flow has no custom message yet, add one from the "${flow.name}" flow settings.)`,
  };
  emit({ type: "part", part });
  return { parts: [part] };
};

const suggestHelpDesk: ActionHandler = async ({
  assistant,
  recommendHelpDesk,
  emit,
}) => {
  const recommended = (await recommendHelpDesk?.()) ?? null;
  const part: ChatReplyPart = {
    type: "help_desk",
    action: "suggest_help_desk",
    label: contactLabel(assistant),
    ...(recommended ? { helpDeskId: recommended } : {}),
  };
  emit({ type: "part", part });
  return { parts: [part] };
};

const GENERIC_FOLLOW_UPS = ["What else can you help me with?", "How do I get started?"];

/**
 * How much of the answer the follow-up prompt sees. Chips need the answer's
 * topic and language, not its every detail, a bounded excerpt keeps the call
 * fast on long RAG answers without un-grounding the questions.
 */
const FOLLOW_UP_ANSWER_EXCERPT = 2000;

/**
 * Grounds follow-ups in the answer just given this turn (priorParts) instead
 * of guessing blind, a chip like "How do I get started?" after a factual RAG
 * answer reads as broken. Runs on the classifier-tier model: the chips appear
 * after the answer is already on screen, so this call is pure perceived
 * latency and the flagship model buys nothing here. Falls back to the generic
 * pair when there's no answer text yet to ground in, or the call errors.
 */
async function generateContextualFollowUps(
  model: LanguageModel,
  message: string,
  priorParts: ChatReplyPart[],
  recordUsage?: ActionContext["recordUsage"]
): Promise<string[]> {
  const answer = priorParts
    .filter((p): p is Extract<ChatReplyPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n")
    .trim();
  if (!answer) return GENERIC_FOLLOW_UPS;

  try {
    const { object, usage } = await generateObject({
      model,
      schema: z.object({ questions: z.array(z.string()).min(2).max(3) }),
      system:
        "Suggest short, natural follow-up questions a chat user might ask next, grounded strictly in the assistant's answer below, never invent facts beyond it. Match the answer's language. Keep each under 12 words.",
      prompt: `User asked: """${message}"""\n\nAssistant answered: """${answer.slice(0, FOLLOW_UP_ANSWER_EXCERPT)}"""`,
    });
    recordUsage?.(usageTotals(usage));
    return object.questions.slice(0, 3);
  } catch {
    return GENERIC_FOLLOW_UPS;
  }
}

const followUpQuestions: ActionHandler = async ({
  assistant,
  chatModel,
  fastModel,
  flow,
  message,
  priorParts,
  emit,
  recordUsage,
  recordFastUsage,
}) => {
  const settings = flow.actionSettings?.follow_up_questions;

  let questions: string[];
  if (settings?.mode === "manual") {
    // Manual mode: show the author's fixed list verbatim, never call a model.
    const manual = (settings.questions ?? [])
      .map((q) => q.trim())
      .filter((q) => q.length > 0)
      .slice(0, 3);
    questions = manual.length > 0 ? manual : GENERIC_FOLLOW_UPS;
  } else {
    const model = fastModel ?? chatModel;
    questions =
      assistant.suggestedQuestions.length > 0
        ? assistant.suggestedQuestions.slice(0, 3)
        : model
          ? await generateContextualFollowUps(
              model,
              message,
              priorParts,
              fastModel ? recordFastUsage : recordUsage
            )
          : GENERIC_FOLLOW_UPS;
  }
  const part: ChatReplyPart = { type: "follow_ups", action: "follow_up_questions", questions };
  emit({ type: "part", part });
  return { parts: [part] };
};

const showButton: ActionHandler = async ({ flow, emit, templateContext }) => {
  const settings = flow.actionSettings?.show_button;
  if (settings?.type === "help_desk") {
    if (!settings.helpDeskId) return { parts: [] };
    const part: ChatReplyPart = {
      type: "help_desk",
      action: "show_button",
      label: settings.label?.trim() || "Contact support",
      helpDeskId: settings.helpDeskId,
      showIcon: settings.showIcon ?? false,
      icon: settings.icon ?? "headset",
    };
    emit({ type: "part", part });
    return { parts: [part] };
  }
  if (settings?.type === "send_text") {
    const text = settings.text?.trim();
    if (!text) return { parts: [] };
    const part: ChatReplyPart = {
      type: "button",
      action: "show_button",
      label: settings.label?.trim() || "Send message",
      buttonType: "send_text",
      text: resolveTemplate(text, templateContext ?? {}),
      showIcon: settings.showIcon ?? false,
      icon: settings.icon ?? "message",
    };
    emit({ type: "part", part });
    return { parts: [part] };
  }
  if (settings?.type === "faq") {
    const text = settings.faqQuestion?.trim();
    if (!text) return { parts: [] };
    const part: ChatReplyPart = {
      type: "button",
      action: "show_button",
      label: settings.label?.trim() || text,
      buttonType: "faq",
      text,
      showIcon: settings.showIcon ?? false,
      icon: settings.icon ?? "message",
    };
    emit({ type: "part", part });
    return { parts: [part] };
  }
  if (!settings?.url) return { parts: [] };
  const part: ChatReplyPart = {
    type: "button",
    action: "show_button",
    label: settings.label?.trim() || "Open link",
    buttonType: "external_link",
    // Normalised like the iframe action twelve lines below, for the same reason
    // and one more: the builder stores a bare host, and a stored `javascript:`
    // or `data:` URL must never reach a link or a `window.open`. React's own
    // href sanitiser covers the anchor sinks; the widget's quick-reply handler
    // opens the value directly, so the scheme is settled here instead.
    url: externalLinkUrl(settings.url),
    showIcon: settings.showIcon ?? (settings.type ? false : true),
    icon: settings.icon ?? "message",
  };
  emit({ type: "part", part });
  return { parts: [part] };
};

/**
 * Build the `iframe` reply part from its stored settings, applying defaults
 * (30 vh height, lightbox on). Returns null when no URL is configured so the
 * action is skipped rather than emitting an empty embed.
 */
function iframeReplyPart(
  settings: FlowActionSettings["iframe"]
): Extract<ChatReplyPart, { type: "iframe" }> | null {
  const raw = settings?.url?.trim();
  if (!raw) return null;
  // The builder stores a bare host (the `https://` prefix is a fixed addon);
  // re-add a protocol so the iframe `src` is absolute. Leave existing
  // protocols (incl. http://) untouched.
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const heightUnit = settings?.heightUnit === "px" ? "px" : "vh";
  const height =
    typeof settings?.height === "number" && settings.height > 0
      ? settings.height
      : 30;
  return {
    type: "iframe",
    action: "iframe",
    url,
    title: settings?.title?.trim() || undefined,
    lightbox: settings?.lightbox ?? true,
    height,
    heightUnit,
  };
}

const iframe: ActionHandler = async ({ flow, emit }) => {
  const part = iframeReplyPart(flow.actionSettings?.iframe);
  if (!part) return { parts: [] };
  emit({ type: "part", part });
  return { parts: [part] };
};

/**
 * Search knowledge: the thin Flow Action adapter over the AgenticSearch
 * entrypoint (agentic-search/run.ts, #206). It resolves the flow's
 * search_knowledge settings (template-resolved answering style / search
 * guidelines), keeps the deterministic no-model lexical fallback, wires the
 * tool registry into the run, and applies flow policy to the outcome: the
 * escalate-prompt chip and the auto-Improvement effect when nothing grounded
 * the answer. The generative loop itself, query understanding, clarify,
 * seeding, the model agent loop, terminal shaping, lives in the module.
 */
const searchKnowledgeHandler: ActionHandler = async ({
  assistant,
  platformPrompt,
  flow,
  message,
  history,
  collectionId,
  chatModel,
  searchKnowledge,
  readKnowledgeDocument,
  apiIntegration,
  session,
  skills,
  longTermMemory,
  searchMemories,
  entities,
  queryEntityRecords,
  toolSubject,
  alreadyClarified = false,
  emit,
  signal,
  recordUsage,
  previewSurface,
  templateContext,
  recommendHelpDesk,
}) => {
  const searchSettings = flow.actionSettings?.search_knowledge;
  const flowStyle: FlowStyleContext | undefined = searchSettings
    ? {
        answeringStyle: searchSettings.answeringStyle?.trim()
          ? resolveTemplate(searchSettings.answeringStyle, templateContext ?? {})
          : undefined,
        overrideAnsweringStyle: searchSettings.overrideAnsweringStyle,
        searchGuidelines: searchSettings.searchGuidelines?.trim()
          ? resolveTemplate(
              searchSettings.searchGuidelines,
              templateContext ?? {}
            )
          : undefined,
      }
    : undefined;
  if (!chatModel) {
    // The deterministic path searches for real, so it reports a real tool call
    // rather than a phase label: same panel row, same ×N counter, same icon as
    // the model-driven search it stands in for (#560).
    const callId = `keyword-search-${Date.now()}`;
    const startedAt = Date.now();
    emit({
      type: "tool-start",
      callId,
      tool: "searchKnowledge",
      label: `Searching knowledge for “${message.slice(0, 60)}”`,
      input: { queries: [message] },
    });
    const results = searchKnowledge ? await searchKnowledge(message) : [];
    emit({
      type: "tool-end",
      callId,
      tool: "searchKnowledge",
      ok: true,
      summary:
        results.length > 0
          ? `Found ${results.length} relevant concept${results.length > 1 ? "s" : ""}`
          : "No matching knowledge found",
      durationMs: Date.now() - startedAt,
    });
    if (results.length > 0) {
      const textPart: ChatReplyPart = {
        type: "text",
        action: "search_knowledge",
        text: `Here's what I found in the knowledge base:\n\n${results
          .slice(0, 3)
          .map((result) =>
            `• ${result.conceptTitle}: ${result.content.slice(0, 300)}`
          )
          .join("\n\n")}`,
      };
      const sourcesPart = dedupSources(results);
      emit({ type: "part", part: textPart });
      if (sourcesPart) emit({ type: "part", part: sourcesPart });
      return {
        parts: sourcesPart ? [textPart, sourcesPart] : [textPart],
      };
    }

    const textPart: ChatReplyPart = {
      type: "text",
      action: "search_knowledge",
      text: "I couldn't find a reliable answer to that in the knowledge base. Could you rephrase the question, or ask about something else?",
    };
    const parts: ChatReplyPart[] = [textPart];
    emit({ type: "part", part: textPart });
    if (searchSettings?.escalatePrompt) {
      const recommended = (await recommendHelpDesk?.()) ?? null;
      const helpPart: ChatReplyPart = {
        type: "help_desk",
        action: "suggest_help_desk",
        label: contactLabel(assistant),
        ...(recommended ? { helpDeskId: recommended } : {}),
      };
      emit({ type: "part", part: helpPart });
      parts.push(helpPart);
    }
    const effects = searchSettings?.improvementItems
      ? [
          {
            kind: "create_improvement" as const,
            title: `Review: ${message.slice(0, 80)}`,
          },
        ]
      : undefined;
    return { parts, effects };
  }

  // The generative retrieval turn lives behind the AgenticSearch entrypoint
  // (#206); this adapter only wires the tool registry in and applies flow
  // policy to the outcome below.
  const apiResponses = createApiResponseStore();
  const outcome = await runAgenticSearch({
    assistant,
    platformPrompt,
    flow,
    message,
    history,
    collectionId,
    chatModel,
    searchKnowledge,
    session,
    skills,
    longTermMemory,
    alreadyClarified,
    flowStyle,
    contactLabel: contactLabel(assistant),
    buildTools: ({
      searchPasses,
      usedSources,
      loop,
      terminal,
      writeTimeStyle,
      narrate,
      showPart,
    }) =>
      buildToolset({
        assistant,
        session,
        searchKnowledge,
        searchMemories,
        entities,
        queryEntityRecords,
        toolSubject,
        readKnowledgeDocument,
        apiIntegration,
        // One response store per turn: a windowed-read handle must survive
        // across the turn's model calls (the toolset itself is built once).
        apiResponses,
        usedSources,
        searchPasses,
        loop,
        terminal,
        writeTimeStyle,
        narrate,
        showPart,
        emit,
        signal,
      }),
    emit,
    signal,
    recordUsage,
    previewSurface,
  });
  // Terminal turns (clarify, refusal, truncation) take no flow policy on top.
  if (outcome.terminal) return { parts: outcome.parts };

  const parts = [...outcome.parts];
  // Builder toggle: offer escalation when nothing grounded the answer.
  if (searchSettings?.escalatePrompt && !outcome.grounded) {
    const recommended = (await recommendHelpDesk?.()) ?? null;
    const part: ChatReplyPart = {
      type: "help_desk",
      action: "suggest_help_desk",
      label: contactLabel(assistant),
      ...(recommended ? { helpDeskId: recommended } : {}),
    };
    emit({ type: "part", part });
    parts.push(part);
  }
  const effects =
    searchSettings?.improvementItems && !outcome.grounded
      ? [
          {
            kind: "create_improvement" as const,
            title: `Review: ${message.slice(0, 80)}`,
          },
        ]
      : undefined;
  return { parts, effects };
};

/** Flags the answer for the Improvements tracker, silent (no user-visible part). */
const improvement: ActionHandler = async ({ flow, message }) => {
  const title = `Review: ${message.slice(0, 80)}`.trim() || `Review: ${flow.name}`;
  return { parts: [], effects: [{ kind: "create_improvement", title }] };
};

/**
 * Calls an admin-configured external endpoint through the shared egress guard
 * (SSRF hardening, DNS-rebind pinning, no redirects, timeout + size cap,
 * egress.ts / docs/audits/api-request-egress-policy.md) and reports the outcome.
 * Method/URL/query/headers/auth/body are configurable with template variables;
 * JSON-path response values become variables for later actions this turn. The
 * execution core is shared with the builder's "Test request" (api-request.ts).
 */
const apiRequest: ActionHandler = async ({
  flow,
  message,
  emit,
  signal,
  templateContext,
}) => {
  const settings = flow.actionSettings?.api_request;
  if (!settings?.url) return { parts: [] };
  emit({ type: "notice", label: "Calling external API" });

  // The runtime falls the empty body back to the triggering message; feed it
  // through the shared `workflow.message` slot the core reads.
  const ctx = { ...(templateContext ?? {}) };
  if (ctx["workflow.message"] === undefined) ctx["workflow.message"] = message;

  const outcome = await executeApiRequest(settings, ctx, signal);
  const { extracted, parseFailed } = extractApiJsonPaths(
    settings,
    outcome.bodyText
  );
  // Extraction misses are flagged for the admin (never fail the HTTP outcome).
  for (const item of extracted) {
    if (item.missed) {
      emit({
        type: "notice",
        label: `API response had no value for ${item.variable}`,
      });
    }
  }
  if (parseFailed)
    emit({ type: "notice", label: "API response was not valid JSON" });
  const templatePatch =
    extracted.length > 0
      ? Object.fromEntries(extracted.map((e) => [e.variable, e.value]))
      : undefined;

  const part: ChatReplyPart = {
    type: "text",
    action: "api_request",
    // Policy blocks, network failures and timeouts all read the same to the
    // visitor, "blocked" must be indistinguishable from "down" (§9).
    text: outcome.ok
      ? "Your request was submitted successfully."
      : "Sorry, that request couldn't be completed right now.",
  };
  emit({ type: "part", part });
  return { parts: [part], templatePatch };
};

/**
 * Acknowledges the handover and halts the flow, signalling the target so the
 * Conversation Turn continues this same message inside the target Assistant's
 * Publication (one hop only, see turn.ts).
 */
const handover: ActionHandler = async ({ flow, emit }) => {
  const targetId = flow.actionSettings?.handover?.assistantId?.trim();
  const part: ChatReplyPart = {
    type: "text",
    action: "handover",
    text: targetId
      ? "I'm handing this conversation over to a more specialized assistant."
      : "(Handover is enabled but no target assistant is set.)",
  };
  emit({ type: "part", part });
  return {
    parts: [part],
    halt: true,
    ...(targetId ? { handoverTo: targetId } : {}),
  };
};

/**
 * Forwards the message to a configured address via the email transport seam
 * (lib/runtime/email.ts). Delivery happens post-commit as a deferred effect.
 */
const sendEmail: ActionHandler = async ({ flow, assistant, message, emit }) => {
  const to = flow.actionSettings?.send_email?.to?.trim();
  if (!to) return { parts: [] };
  // Honest copy: never claim delivery when the transport can't deliver.
  const configured = emailTransportConfigured();
  const part: ChatReplyPart = {
    type: "text",
    action: "send_email",
    text: configured
      ? "Thanks, your message has been forwarded to the team."
      : "I couldn't forward your message automatically. Please use the contact options to reach the team directly.",
  };
  emit({ type: "part", part });
  return {
    parts: [part],
    effects: configured
      ? [
          {
            kind: "send_email",
            to,
            subject: `New message via ${assistant.nickname || assistant.title}`,
            body: message,
          },
        ]
      : [],
  };
};

/**
 * The proactive nudge (#541): emitted verbatim, exactly as `custom_message` is,
 * so a proactive turn makes no model call and meters no tokens. An empty
 * Notification emits nothing rather than an apology, the editor refuses to save
 * one, and a Visitor must never be interrupted to be told the nudge is unwritten.
 */
const notification: ActionHandler = async ({ flow, templateContext, emit }) => {
  const settings = flow.actionSettings?.notification;
  const ctx = templateContext ?? {};
  const content = resolveTemplate(settings?.content ?? "", ctx).trim();
  if (!content) return { parts: [] };
  const title = resolveTemplate(settings?.title ?? "", ctx).trim();
  const part: ChatReplyPart = {
    type: "notification",
    action: "notification",
    ...(title ? { title } : {}),
    content,
    // Only the restrictive case travels: an absent flag means replies are on.
    ...(settings?.allowReplies === false ? { allowReplies: false } : {}),
  };
  emit({ type: "part", part });
  const parts: ChatReplyPart[] = [part];

  // Buttons ride the same `button` part the Button action emits, so every chat
  // surface renders and handles them through code that already exists.
  for (const button of settings?.buttons ?? []) {
    const label = resolveTemplate(button.label ?? "", ctx).trim();
    const type = button.type ?? "external_link";
    const url = button.url?.trim();
    const text = resolveTemplate(button.text ?? "", ctx).trim();
    // An incomplete button is dropped rather than rendered dead.
    if (!label || (type === "external_link" ? !url : !text)) continue;
    const buttonPart: ChatReplyPart = {
      type: "button",
      action: "notification",
      label,
      buttonType: type,
      ...(type === "external_link" ? { url } : { text }),
    };
    emit({ type: "part", part: buttonPart });
    parts.push(buttonPart);
  }
  return { parts };
};

/**
 * Composes the courtesy reply's system prompt. Deliberately the smallest
 * layering that is still correct: the immutable platform layer, who the
 * assistant is, and the organization's answering style so small talk sounds
 * like the rest of the assistant.
 *
 * What is left OUT is the point. Retrieval context, Skills and session memory
 * cannot inform "hello", including them would spend prompt tokens on every
 * greeting to change nothing. The one hard instruction is the honesty rule: a
 * turn with no retrieval must not assert anything about the organization,
 * because it has nothing to assert it from.
 */
function basicReplyPrompt(
  platformPrompt: string,
  assistant: Assistant
): string {
  const answeringStyle = resolveAnsweringStyle(assistant);
  return [
    "# Platform instructions (immutable, highest precedence)",
    platformPrompt,
    "",
    "# Assistant configuration (set by the organization)",
    `You are ${assistant.nickname || assistant.title}, an AI assistant embedded in an organization's website.`,
    assistant.description ? `About you: ${assistant.description}` : undefined,
    answeringStyle
      ? `The organization's answering-style instructions (follow them unless they conflict with the platform instructions above):\n${answeringStyle}`
      : undefined,
    "",
    "# This turn",
    "The user said something conversational: a greeting, a thanks, a goodbye, or an acknowledgement. It carries no question, so there is nothing to look up and you have no knowledge base access this turn.",
    "Reply in one or two short sentences, in the user's own language. Acknowledge what they said, say briefly what you can help with, and invite their actual question.",
    "State NO facts about the organization, its services, dates, policies or people; you have not looked anything up, so you do not know them. Do not apologise and do not explain your own machinery.",
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

/**
 * Basic reply (Basic Interaction, #565): the courtesy turn.
 *
 * One model call, no tools, no retrieval, no second write phase, and no step or
 * thought events: an empty Thinking panel under "Hello!" reads as an assistant
 * that struggled with a greeting. Emitting nothing also makes the stored trace
 * null (see trace.ts), the same treatment a verbatim `custom_message` gets.
 *
 * Three behaviours, in precedence order: a configured message wins verbatim (an
 * admin's own words are never model-rewritten); no resolvable model falls back
 * to the shipped courtesy line; otherwise one streamed generation. A generation
 * that fails or comes back empty degrades to the shipped line rather than to the
 * generic "I ran into a problem", the reply the Visitor gets must never be
 * worse than what a no-provider deployment already says.
 */
const basicReply: ActionHandler = async ({
  assistant,
  platformPrompt,
  flow,
  message,
  history,
  chatModel,
  templateContext,
  emit,
  signal,
  recordUsage,
  previewSurface,
}) => {
  const verbatim = (text: string) => {
    const part: ChatReplyPart = { type: "text", action: "basic_reply", text };
    emit({ type: "part", part });
    return { parts: [part] };
  };

  const configured = resolveTemplate(
    flow.actionSettings?.basic_reply?.message ?? "",
    templateContext ?? {}
  ).trim();
  if (configured) return verbatim(configured);
  if (!chatModel) return verbatim(DEFAULT_BASIC_REPLY);

  // Just enough history for "thanks" after an answer to read as a reply to it,
  // and not enough to re-pay for the conversation on every courtesy turn.
  const recent = history.slice(-BASIC_REPLY_HISTORY);
  let text = "";
  let textOpen = false;
  try {
    const reply = streamText({
      model: chatModel,
      system: basicReplyPrompt(platformPrompt, assistant),
      messages: [
        ...recent.map((m) => ({ role: m.role, content: m.text })),
        { role: "user" as const, content: message },
      ],
      abortSignal: signal,
    });
    for await (const chunk of reply.fullStream) {
      if (chunk.type === "text-delta") {
        if (!textOpen) {
          emit({ type: "text-start", action: "basic_reply" });
          textOpen = true;
        }
        text += chunk.text;
        emit({ type: "text-delta", delta: chunk.text });
      } else if (chunk.type === "error") {
        throw chunk.error instanceof Error
          ? chunk.error
          : new Error(errorMessageOf(chunk.error));
      }
    }
    if (textOpen) emit({ type: "text-end" });
    try {
      recordUsage?.(usageTotals(await reply.totalUsage));
    } catch {
      // usage unavailable from this provider/mock, accounting must never fail a
      // turn that already answered
    }
  } catch (error) {
    if (textOpen) emit({ type: "text-end" });
    if (signal?.aborted) throw error;
    // Degrade rather than rethrow: the engine's error copy ("I ran into a
    // problem answering that") is a worse reply to "hello" than the line an
    // offline deployment already gives. A provider outage is not silent, it
    // shows up in the log here and, from the turns that DO retrieve, in the
    // provider-health Alert.
    console.error("[runtime] basic_reply generation failed:", errorMessageOf(error));
    // Provider internals are admin diagnostics, never shown to a Visitor.
    if (previewSurface && !text.trim()) {
      return verbatim(
        `${DEFAULT_BASIC_REPLY} (Basic reply generation failed: ${errorMessageOf(error)}. Check the provider configuration in Settings → AI.)`
      );
    }
  }

  const trimmed = text.trim();
  if (!trimmed) return verbatim(DEFAULT_BASIC_REPLY);
  // Already streamed, so the part is persisted rather than re-emitted.
  return { parts: [{ type: "text", action: "basic_reply", text: trimmed }] };
};

/** The registry: FlowAction → Adapter. Complete (no fall-through). */
export const ACTION_HANDLERS: Record<FlowAction, ActionHandler> = {
  custom_message: customMessage,
  basic_reply: basicReply,
  search_knowledge: searchKnowledgeHandler,
  suggest_help_desk: suggestHelpDesk,
  follow_up_questions: followUpQuestions,
  show_button: showButton,
  iframe,
  improvement,
  api_request: apiRequest,
  handover,
  send_email: sendEmail,
  notification,
};

export type { ActionContext, ActionHandler };
