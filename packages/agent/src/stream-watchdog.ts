import type { LanguageModelMiddleware } from "ai";

/**
 * Abort a model stream that has gone silent, and retry it once when it went
 * silent before saying anything.
 *
 * The SDK's request timeout is satisfied the moment the provider answers 200,
 * so a body that stops sending chunks after that is never caught: the turn
 * waits until the chat route's 300s `maxDuration` kills the function, still
 * holding its concurrency lease and its turn claim. This middleware resets a
 * timer on every chunk and, when `idleMs` passes with nothing, cancels the
 * body.
 *
 * A stall before the first content chunk is retried (once, by default): the
 * leading `stream-start` / `response-metadata` chunks are withheld until
 * content arrives, so a retry cannot duplicate anything the caller saw. A
 * stall after content has streamed is never retried, because the Visitor has
 * already read the start of an answer a second attempt would not reproduce; it
 * becomes a {@link ProviderStreamStalledError} error chunk instead.
 *
 * It wraps each step's `doStream`, so in the gather loop a retry repeats one
 * step, not the turn, and never re-runs a tool that already ran.
 */

export interface StreamWatchdogPolicy {
  /** Longest silence between two chunks (or before the first one). */
  idleMs: number;
  /** Fresh attempts after a stall that happened before any content. */
  retries: number;
}

/**
 * 90s of silence, as in the agent this was learned from. Shorter would cut
 * off a reasoning model that thinks without streaming a summary; longer gets
 * close enough to `maxDuration` that the retry has no room left.
 */
export const INTERACTIVE_STREAM_WATCHDOG: StreamWatchdogPolicy = {
  idleMs: 90_000,
  retries: 1,
};

/** A provider stream sent nothing for `idleMs` and was abandoned. */
export class ProviderStreamStalledError extends Error {
  override readonly name = "ProviderStreamStalledError";
  readonly idleMs: number;

  constructor(idleMs: number) {
    super(`The model stopped responding for ${Math.round(idleMs / 1000)}s.`);
    this.idleMs = idleMs;
  }
}

type StreamResult = Awaited<
  ReturnType<Parameters<NonNullable<LanguageModelMiddleware["wrapStream"]>>[0]["doStream"]>
>;
type Chunk = StreamResult["stream"] extends ReadableStream<infer C> ? C : never;

/** Chunks that announce a stream rather than carry any of its content. */
function isPreamble(chunk: Chunk): boolean {
  const type = (chunk as { type?: string }).type;
  return type === "stream-start" || type === "response-metadata";
}

const STALLED = Symbol("stalled");

/** The next chunk, or {@link STALLED} when none arrives within `idleMs`. */
async function readWithin(
  reader: ReadableStreamDefaultReader<Chunk>,
  idleMs: number
): Promise<ReadableStreamReadResult<Chunk> | typeof STALLED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stall = new Promise<typeof STALLED>((resolve) => {
    timer = setTimeout(() => resolve(STALLED), idleMs);
  });
  try {
    return await Promise.race([reader.read(), stall]);
  } finally {
    clearTimeout(timer);
  }
}

export function streamWatchdogMiddleware(
  policy: StreamWatchdogPolicy = INTERACTIVE_STREAM_WATCHDOG
): LanguageModelMiddleware {
  return {
    wrapStream: async ({ doStream }) => {
      let result = await doStream();
      let attemptsLeft = policy.retries;
      const first = result;
      // The live attempt's reader; a caller that cancels cancels this one.
      let reader = result.stream.getReader();

      const stream = new ReadableStream<Chunk>({
        async start(controller) {
          let preamble: Chunk[] = [];
          let content = false;
          try {
            for (;;) {
              const next = await readWithin(reader, policy.idleMs);
              if (next === STALLED) {
                void reader.cancel().catch(() => {});
                if (content || attemptsLeft === 0) {
                  // An in-stream error chunk, the way a provider reports one,
                  // so callers handle it on the path they already have.
                  controller.enqueue({
                    type: "error",
                    error: new ProviderStreamStalledError(policy.idleMs),
                  } as Chunk);
                  controller.close();
                  return;
                }
                attemptsLeft -= 1;
                preamble = [];
                result = await doStream();
                reader = result.stream.getReader();
                continue;
              }
              if (next.done) break;
              if (!content && isPreamble(next.value)) {
                preamble.push(next.value);
                continue;
              }
              if (!content) {
                content = true;
                for (const chunk of preamble) controller.enqueue(chunk);
              }
              controller.enqueue(next.value);
            }
            for (const chunk of content ? [] : preamble) controller.enqueue(chunk);
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
        cancel(reason) {
          return reader.cancel(reason).catch(() => {});
        },
      });

      // Request/response metadata describe the attempt that started; a retry
      // re-sends the same request, so they stay accurate enough to report.
      return { ...first, stream };
    },
  };
}
