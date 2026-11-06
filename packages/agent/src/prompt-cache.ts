import type { ModelMessage, SystemModelMessage } from "ai";

/**
 * Prompt-cache breakpoints for model calls that resend the same prefix.
 *
 * The gather phase is the case that pays: up to 8 steps in one turn, each
 * resending the same instructions and tools plus everything gathered so far.
 * A breakpoint on the instructions and one on the conversation tail let every
 * step after the first read that prefix from the provider's cache instead of
 * paying for it again.
 *
 * Only Anthropic needs explicit breakpoints; the option is keyed by provider,
 * so every other provider ignores it (OpenAI and Gemini cache a stable prefix
 * on their own). Two of Anthropic's four breakpoints are used.
 *
 * Do not put a breakpoint on a one-shot call: a cache write costs more than
 * the plain input it replaces, so a prefix nobody reads again is a loss.
 */
const BREAKPOINT = {
  anthropic: { cacheControl: { type: "ephemeral" as const } },
};

/** The instructions as one system message marked as a cache breakpoint. */
export function cachedInstructions(text: string): SystemModelMessage {
  return { role: "system", content: text, providerOptions: BREAKPOINT };
}

/**
 * The same messages with the last one marked as a breakpoint, so the next
 * step reads everything up to here from the cache. Earlier marks are left
 * alone: a mark the provider no longer needs costs nothing.
 */
export function withCachedTail(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1]!;
  return [
    ...messages.slice(0, -1),
    { ...last, providerOptions: { ...last.providerOptions, ...BREAKPOINT } } as ModelMessage,
  ];
}
