/**
 * Tolerant parse of a JSON object that is still being written.
 *
 * The render-only tools (see `render-tools.ts`) put their component props in
 * the tool call's *arguments*, and the model writes those arguments a token at
 * a time. To render a component while it materializes, the live chat client has
 * to make sense of `{"title":"Pri` before the closing brace exists.
 *
 * Deliberately dependency-free, and deliberately not the AI SDK's
 * `parsePartialJson`: this module is imported by `client.ts`, so anything it
 * touches lands in a browser bundle (the same reason `MAX_AGENT_ITERATIONS`
 * comes from `loop-budget.ts` rather than through the `agentic-search` barrel).
 *
 * **Returning `undefined` is always safe.** The caller keeps the last value
 * that did parse, so a fragment this repair cannot make sense of costs one
 * frame of latency, never a wrong render. That is what lets the repair stay
 * readable instead of exhaustive.
 */

/** What the scan learned about where the text stopped. */
interface ScanState {
  /** Closers owed to still-open containers, innermost last. */
  closers: string[];
  /** The text ended inside a string literal. */
  inString: boolean;
  /** That unterminated string is an object KEY, not a value. */
  stringIsKey: boolean;
  /** Index of the quote that opened the unterminated string. */
  stringStart: number;
  /**
   * Index just past the last structural boundary outside a string: the `,`,
   * `:`, `{` or `[` a partial trailing token can be cut back to.
   */
  lastBoundary: number;
}

function scan(text: string): ScanState {
  const frames: Array<{ object: boolean; expectKey: boolean }> = [];
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  let stringIsKey = false;
  let stringStart = 0;
  let lastBoundary = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    const frame = frames[frames.length - 1];
    switch (char) {
      case '"':
        inString = true;
        stringStart = i;
        // In an object, a string where a key is expected IS the key. That
        // distinction decides whether an unterminated string can be closed
        // (a value) or has to be dropped (a key with no colon behind it).
        stringIsKey = Boolean(frame?.object && frame.expectKey);
        break;
      case "{":
        frames.push({ object: true, expectKey: true });
        closers.push("}");
        lastBoundary = i + 1;
        break;
      case "[":
        frames.push({ object: false, expectKey: false });
        closers.push("]");
        lastBoundary = i + 1;
        break;
      case "}":
      case "]":
        frames.pop();
        closers.pop();
        break;
      case ":":
        if (frame) frame.expectKey = false;
        lastBoundary = i + 1;
        break;
      case ",":
        if (frame?.object) frame.expectKey = true;
        lastBoundary = i + 1;
        break;
      default:
        break;
    }
  }
  return { closers, inString, stringIsKey, stringStart, lastBoundary };
}

/** Drops a trailing `,` or `:` (and, for `:`, the dangling key before it). */
function trimDangling(text: string): string {
  let end = text.replace(/\s+$/, "");
  for (;;) {
    if (end.endsWith(",")) {
      end = end.slice(0, -1).replace(/\s+$/, "");
      continue;
    }
    if (end.endsWith(":")) {
      // A key with no value yet: cut the key too, back to its opening quote.
      const withoutColon = end.slice(0, -1).replace(/\s+$/, "");
      const quote = withoutColon.lastIndexOf('"', withoutColon.length - 2);
      end = quote >= 0 ? withoutColon.slice(0, quote).replace(/\s+$/, "") : withoutColon;
      continue;
    }
    break;
  }
  return end.replace(/,\s*$/, "");
}

function closeWith(text: string, closers: readonly string[]): string {
  return text + [...closers].reverse().join("");
}

/**
 * Parses as much of `text` as forms a coherent value. Returns `undefined` when
 * nothing coherent is there yet (the empty string, `{"`, a fragment the repair
 * could not resolve).
 */
export function parsePartialJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const state = scan(trimmed);
  // Candidates, cheapest and most faithful first. Each is a whole JSON
  // document; the first that parses wins.
  const candidates: string[] = [];
  if (state.inString) {
    if (state.stringIsKey) {
      // `{"a":1,"ti` : the partial key carries no information yet, so drop it.
      candidates.push(
        closeWith(trimDangling(trimmed.slice(0, state.stringStart)), state.closers)
      );
    } else {
      // `{"title":"Pri` : a partial value is still a value.
      candidates.push(closeWith(`${trimmed}"`, state.closers));
    }
  } else {
    // A complete token at the tail (`{"n":12`, `{"a":[]`, `{"a":true`).
    candidates.push(closeWith(trimmed, state.closers));
    // A partial bare literal (`{"n":12.`, `{"a":tr`) cannot be closed, so cut
    // back to the last boundary and drop whatever it left dangling.
    candidates.push(
      closeWith(trimDangling(trimmed.slice(0, state.lastBoundary)), state.closers)
    );
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Next candidate; exhausting them means "not yet", not "invalid".
    }
  }
  return undefined;
}
