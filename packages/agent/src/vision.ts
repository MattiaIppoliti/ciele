import { generateText } from "ai";
import type { Provider, ProviderConnection } from "@agent-hub/core";
import { resolveChatModel, type KeyResolution } from "./models";

/**
 * Reads an image: the closest thing to OCR this product has, and deliberately
 * not OCR.
 *
 * There is no optical-character-recognition component in Ciele, and adding one
 * would mean a second inference stack to keep, feed and secure for the one
 * input type a chat model already reads better than it would. So an image is
 * extracted the same way every other attachment is, by asking the
 * Organization's own provider connection what the picture says, and the answer
 * joins the pipeline at exactly the point a PDF's text does.
 *
 * Two consequences worth stating rather than discovering. It costs one model
 * call per image, metered through the usage ledger like any other; and it reads
 * *more* than characters, so a photograph of a shelf yields a description and a
 * screenshot yields its words. Both are what a reader of the conversation
 * wanted, which a character recogniser would not have given them.
 */

/** What a caller hands the extractor to turn image bytes into words. */
export type VisionReader = (input: {
  bytes: ArrayBuffer;
  mediaType: string;
  name: string;
}) => Promise<string>;

/**
 * The instruction. Transcription first, because a screenshot of an error or an
 * invoice is the common case and its words are the whole point; description
 * second, for the photograph where there are none. It asks for neither
 * commentary nor an opening line, because this text is pasted into a prompt,
 * not shown to anybody.
 */
const PROMPT = [
  "Read this image for a colleague who cannot see it.",
  "Transcribe every piece of text in it exactly, keeping the reading order and any table or form structure.",
  "Then, in one short paragraph, say what the image shows.",
  "Write nothing else: no preamble, no apology, no offer of help.",
].join(" ");

/** Output cap: an image's reading is context for a turn, not a document. */
const MAX_OUTPUT_TOKENS = 1_500;

/**
 * Builds a reader over the Organization's connections, or null when it holds
 * no credential any model can answer on.
 *
 * Null rather than a throwing reader, so the caller can say "images are not
 * available here" once, at upload, instead of accepting a file and failing on
 * it afterwards.
 */
export function createVisionReader(
  connections: ProviderConnection[],
  preferred: { provider: Provider; modelId: string },
  resolution: KeyResolution = {}
): VisionReader | null {
  const resolved = resolveChatModel(
    preferred.provider,
    preferred.modelId,
    connections,
    resolution
  );
  if (!resolved) return null;

  return async ({ bytes, mediaType }) => {
    const { text } = await generateText({
      model: resolved.model,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image", image: new Uint8Array(bytes), mediaType },
          ],
        },
      ],
    });
    return text.trim();
  };
}
