"use client";

import { useEffect, useRef, useState } from "react";
import { documentSummaryAction } from "@/app/actions";

/**
 * The Summary card under a Document's Details (#931).
 *
 * Three states, and the labels are the point:
 *
 * - a generated summary, headed **Summary**
 * - the body's first paragraph, headed **Excerpt**, whenever no summary exists
 * - the Excerpt plus a quiet "Summary unavailable" when a generation was tried
 *   and failed
 *
 * The card never says "Summary" over text nobody wrote. It renders the Excerpt
 * immediately from what the server already read, and the generation runs after
 * mount, so Content and Details are on screen while the model works and the
 * route is never held up by it.
 */
export function DocumentSummaryCard({
  sourceId,
  documentId,
  assistantId,
  excerpt,
  cachedSummary,
}: {
  sourceId: string;
  documentId: string;
  assistantId?: string;
  excerpt: string;
  /** Read with the route: present means nobody pays for a call at all. */
  cachedSummary: string | null;
}) {
  const [summary, setSummary] = useState(cachedSummary);
  const [state, setState] = useState<"idle" | "running" | "unavailable">(
    "idle",
  );
  // React runs effects twice in development; a model call is not something to
  // make twice because of that.
  const asked = useRef(false);

  useEffect(() => {
    if (summary !== null || asked.current) return;
    asked.current = true;
    setState("running");
    documentSummaryAction({ sourceId, documentId, assistantId })
      .then((result) => {
        if (result.summary) {
          setSummary(result.summary);
          setState("idle");
        } else {
          // No provider and a failed call look the same from here. Both leave
          // the Excerpt up; the next open tries again.
          setState("unavailable");
        }
      })
      .catch(() => setState("unavailable"));
  }, [summary, sourceId, documentId, assistantId]);

  const heading = summary ? "Summary" : "Excerpt";

  return (
    <section className="bg-card rounded-xl border">
      <h2 className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium">
        {heading}
        {state === "running" && (
          <span className="text-muted-foreground text-xs font-normal">
            Summarising…
          </span>
        )}
      </h2>
      <div className="px-4 py-4">
        <p className="text-sm leading-relaxed whitespace-pre-line">
          {summary || excerpt || "This Document has no body."}
        </p>
        {state === "unavailable" && (
          <p className="text-muted-foreground mt-2 text-xs">
            Summary unavailable.
          </p>
        )}
      </div>
    </section>
  );
}
