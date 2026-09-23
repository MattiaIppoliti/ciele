/**
 * A Document's Summary (ticket ciele-org#931).
 *
 * One classifier-tier call over a Document's body, run the first time a Member
 * opens that Document and cached on the row for everyone after them. It is a
 * reading aid in the Details column, not part of retrieval: nothing indexes
 * it, nothing cites it, and no answer is grounded in it.
 *
 * Best-effort by construction. No Provider Connection, an oversized body or a
 * model error all return null, and the card falls back to the first paragraph
 * of the Content labelled **Excerpt**, never "Summary". Nothing here raises an
 * Alert: a per-open convenience that failed once is not a pipeline in trouble,
 * and the next open retries.
 */

import { generateText } from "ai";
import type { Db } from "@agent-hub/db";
import { getClassifierModel } from "./models";
import { meterUsage } from "./usage";

/**
 * How much of a body the summariser reads. Enough for a long page's shape,
 * bounded so one enormous Document cannot cost a multiple of the rest. The
 * prompt says the text is truncated, so the model describes what it was given
 * rather than inventing an ending.
 */
export const SUMMARY_INPUT_CHARS = 12_000;

const SYSTEM = [
  "You summarise one document for a colleague who is deciding whether to read it.",
  "Write three sentences at most, as a single plain paragraph.",
  "Write in the language the document is written in.",
  "Describe what the document says. Do not address the reader, do not recommend anything, and do not mention that you are summarising.",
  "Never invent a fact that is not in the text.",
].join(" ");

export interface DocumentSummary {
  text: string;
  /** OKF `generated.by`: `<producer>/<version>` for a model. */
  by: string;
}

export async function summariseDocument(input: {
  db: Db;
  organizationId: string;
  title: string;
  body: string;
}): Promise<DocumentSummary | null> {
  const body = input.body.trim();
  if (body.length === 0) return null;

  const connections = await input.db.listProviderConnections(input.organizationId);
  const classifier = getClassifierModel("anthropic", connections);
  // No credential is the ordinary case for a fresh Organization, not an error:
  // the card shows the Excerpt and says nothing about models.
  if (!classifier) return null;

  const truncated = body.length > SUMMARY_INPUT_CHARS;
  const text = body.slice(0, SUMMARY_INPUT_CHARS);

  try {
    const result = await generateText({
      model: classifier.model,
      system: SYSTEM,
      prompt: [
        `Title: ${input.title}`,
        truncated
          ? "Document (truncated; summarise only what is here):"
          : "Document:",
        `"""${text}"""`,
      ].join("\n"),
    });

    await meterUsage(input.db, [
      {
        organizationId: input.organizationId,
        // A Document belongs to the Organization, not to one Assistant (#726),
        // and this call is made from the Library as often as from an editor.
        assistantId: null,
        stage: "enrich",
        provider: classifier.provider,
        modelId: classifier.modelId,
        credentialKind: classifier.credentialKind,
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
        // Summarising a stored Document is knowledge work, whoever's click
        // happened to trigger it.
        surface: "ingestion",
      },
    ]);

    const summary = result.text.trim();
    return summary.length === 0
      ? null
      : { text: summary, by: `document-summariser/${classifier.modelId}` };
  } catch (error) {
    console.error("[summary] generation failed:", error);
    return null;
  }
}
