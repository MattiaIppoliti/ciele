"use client";

import { describePreflightRouting, type PreflightTraceRecord } from "@agent-hub/core";

/**
 * The pre-flight's record on one turn (#952, #953), for the Inbox and only the
 * Inbox. A shadow record is a comparison, what the pre-flight would have done
 * beside what the turn did; a routed record (`acted`) is a fact, the turn went
 * where the pre-flight said.
 *
 * It lives here rather than in the Thinking timeline because that timeline is
 * one component shared by the operator's Inbox, the Visitor's widget and the
 * Preview: a step is a step on everybody's screen. A shadowed turn has to look
 * to a Visitor exactly like an unshadowed one, so the record never became a
 * step, and this panel is reachable only from a page an operator opens.
 *
 * What it has to show is what makes the shadow worth running: the answer, how
 * sure the backend was, where the pre-flight *would* have sent the message, and
 * where the message actually went. Agreement and disagreement are the reading.
 */
export function PreflightRecordPanel({ record }: { record: PreflightTraceRecord }) {
  const agreed = agreement(record);

  return (
    <details className="bg-muted/40 rounded-xl border px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 font-medium">
        <span>Pre-flight</span>
        <span className="text-muted-foreground rounded-full border px-2 py-0.5 font-normal">
          {record.acted ? "routed" : "shadow"}
        </span>
        <span className="text-muted-foreground rounded-full border px-2 py-0.5 font-normal">
          {record.backend}
          {record.calibrated ? "" : ", uncalibrated"}
        </span>
        <span className="text-muted-foreground font-normal">{record.latencyMs} ms</span>
        {record.failure ? (
          <span className="text-destructive font-normal">{failureLabel(record)}</span>
        ) : (
          <span
            className={
              agreed === null
                ? "text-muted-foreground font-normal"
                : agreed
                  ? "font-normal text-emerald-600"
                  : "font-normal text-amber-600"
            }
          >
            {record.acted ? "acted" : agreed === null ? "no comparison" : agreed ? "agreed" : "differed"}
          </span>
        )}
      </summary>

      <div className="text-muted-foreground mt-2 space-y-2">
        <p>
          {record.acted ? "Routed: " : "Would have routed: "}
          <span className="text-foreground">{describePreflightRouting(record.wouldRoute)}</span>
          {" · "}
          {record.acted ? "Flow taken: " : "Actually routed: "}
          <span className="text-foreground">{record.routedFlowId ?? "no flow"}</span>
        </p>

        {record.answers.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="text-left">
                <th className="font-medium">Question</th>
                <th className="font-medium">Answer</th>
                <th className="font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {record.answers.map((answer) => (
                <tr key={answer.id}>
                  <td>{answer.id}</td>
                  <td className="text-foreground">{String(answer.value)}</td>
                  <td>
                    {/* Shown exactly as the provider sent it: rounding a
                        calibration figure is how a calibration figure stops
                        meaning anything. */}
                    {answer.confidence === undefined ? "—" : answer.confidence}
                    {answer.fallback ? " (no distribution)" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {record.faqCatalogue && (
          <p>
            FAQ question asked over {record.faqCatalogue.offered} of{" "}
            {record.faqCatalogue.total} FAQs, so its answer is not comparable with
            the rest.
          </p>
        )}

        <p>
          {record.resolvedModelId} · map v{record.mapVersion} written against{" "}
          {record.mapModelId}
        </p>
      </div>
    </details>
  );
}

/**
 * Whether the pre-flight would have done what the turn did. `null` when the two
 * are not comparable: a fallback is the pre-flight declining to decide, so it
 * neither agrees nor disagrees with whatever classification then chose.
 */
function agreement(record: PreflightTraceRecord): boolean | null {
  const route = record.wouldRoute;
  if (route.kind === "fallback") return null;
  if (route.kind === "flow") return route.flowId === record.routedFlowId;
  return false;
}

function failureLabel(record: PreflightTraceRecord): string {
  const failure = record.failure;
  if (!failure) return "";
  switch (failure.reason) {
    case "timeout":
      return `timed out after ${failure.afterMs} ms`;
    case "error":
      return `failed: ${failure.message}`;
    case "no_questions":
      return `no questions: ${failure.message}`;
  }
}
