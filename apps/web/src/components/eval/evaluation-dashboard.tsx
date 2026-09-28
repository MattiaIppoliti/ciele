"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Coins,
  Gauge,
  SearchCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { modelSelector, type EvaluationResult, type EvaluationRun } from "@agent-hub/core";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { EvaluationLeaderboard } from "@/components/eval/evaluation-leaderboard";
import { ChartSkeleton } from "@/components/insights/dashboard/dashboard-kit";
import { RANK_COLORS } from "@/components/insights/dashboard/palette";

const MetricBars = dynamic(() => import("./evaluation-bars").then((m) => m.MetricBars), {
  ssr: false,
  loading: () => <ChartSkeleton className="h-44" />,
});

const METRICS = [
  {
    key: "accuracy",
    title: "Accuracy",
    unit: "%",
    icon: SearchCheck,
    note: "Only examples with reference outputs",
  },
  {
    key: "cost",
    title: "Cost",
    unit: "€",
    icon: Coins,
    note: "Estimate per example; retrieval costs excluded",
  },
  {
    key: "tokens",
    title: "Tokens",
    unit: "",
    icon: Sparkles,
    note: "Model input and output per example; embeddings excluded",
  },
  {
    key: "latency",
    title: "Latency",
    unit: "ms",
    icon: Clock3,
    note: "Average time per example",
  },
  {
    key: "autonomy",
    title: "Autonomy",
    unit: "%",
    icon: Zap,
    note: "Turns completed without fallback or refusal; not applicable to isolated stages",
  },
  {
    key: "error",
    title: "Error rate",
    unit: "%",
    icon: CircleAlert,
    note: "Executions with technical errors",
  },
] as const;
const candidateKey = modelSelector;
function number(value: number, unit: string) {
  return unit === "€"
    ? `€${value.toFixed(4)}`
    : unit === "%"
      ? `${value.toFixed(1)}%`
      : `${Math.round(value)}${unit ? ` ${unit}` : ""}`;
}
function candidateStats(results: EvaluationResult[]) {
  const count = results.length || 1;
  const graded = results.filter((result) => result.accuracy !== null);
  return {
    accuracy: graded.length
      ? (100 * graded.filter((result) => result.accuracy).length) /
        graded.length
      : null,
    cost: results.reduce((sum, result) => sum + result.costEur, 0) / count,
    tokens:
      results.reduce(
        (sum, result) => sum + result.inputTokens + result.outputTokens,
        0,
      ) / count,
    latency: results.reduce((sum, result) => sum + result.latencyMs, 0) / count,
    autonomy: results.some((result) => result.autonomous !== null)
      ? (100 * results.filter((result) => result.autonomous === true).length) /
        results.filter((result) => result.autonomous !== null).length
      : null,
    error:
      (100 * results.filter((result) => result.error !== null).length) / count,
  };
}

type CandidateStats = ReturnType<typeof candidateStats> & {
  key: string;
  label: string;
  color: string;
  candidate: EvaluationRun["candidates"][number];
};

/** One metric across the run's candidates. The six sit side by side. */
function MetricChart({
  metric,
  stats,
}: {
  metric: (typeof METRICS)[number];
  stats: CandidateStats[];
}) {
  const rows = stats
    .filter((row) => row[metric.key] !== null)
    .map((row) => ({
      key: `m${stats.indexOf(row)}`,
      model: row.label,
      value: row[metric.key] as number,
      color: row.color,
    }));
  const Icon = metric.icon;
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" /> {metric.title}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">{metric.note}</p>
      <div className="mt-3 w-full">
        {rows.length ? (
          <MetricBars
            rows={rows}
            format={(value) => number(value, metric.unit)}
          />
        ) : (
          <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
            Not measured for this stage.
          </div>
        )}
      </div>
    </div>
  );
}

export function EvaluationDashboard({
  run,
  labels,
}: {
  run: EvaluationRun;
  /** Display names by model selector; a model missing here shows its ID. */
  labels: Record<string, string>;
}) {
  const dataset = { name: run.datasetName, examples: run.examples };
  const assistantName = run.assistantName;
  const [selected, setSelected] = useState<string | null>(null);
  const stats: CandidateStats[] = run.candidates.map((candidate, index) => ({
    candidate,
    key: candidateKey(candidate),
    color: RANK_COLORS[index % RANK_COLORS.length]!,
    label: labels[candidateKey(candidate)] ?? candidate.modelId,
    ...candidateStats(
      run.results.filter(
        (result) => candidateKey(result.candidate) === candidateKey(candidate),
      ),
    ),
  }));
  const selectedExample = dataset.examples.find(
    (example) => example.id === selected,
  );
  const selectedResults = run.results.filter(
    (result) => result.exampleId === selected,
  );
  return (
    <div className="mx-auto max-w-7xl space-y-7 px-6 py-8">
      <div>
        <Link
          href="/eval"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All runs
        </Link>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              <RollInText text={`Reliability dashboard · ${run.stage}`} />
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              {dataset.name}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {assistantName} · <RollingNumber value={dataset.examples.length} /> examples ·{" "}
              {new Date(run.createdAt).toLocaleString("en-GB")} · <RollInText text={run.status} />
            </p>
          </div>
          <div className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
            <RollingNumber value={run.candidates.length} /> models
          </div>
        </div>
      </div>
      {run.error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {run.error}
        </p>
      )}
      <section className="grid gap-3 md:grid-cols-3">
        {stats.map((row) => (
          <div key={row.key} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: row.color }} />
              <span className="text-sm font-medium">{row.label}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {row.candidate.provider} ·{" "}
              {
                run.results.filter(
                  (result) => candidateKey(result.candidate) === row.key,
                ).length
              }{" "}
              executions
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <div className="text-2xl font-semibold">
                  <RollInText text={row.accuracy === null ? "—" : number(row.accuracy, "%")} duration={380} />
                </div>
                <div className="text-xs text-muted-foreground">accuracy</div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>{number(row.cost, "€")} / question · model</div>
                <div>{Math.round(row.latency)} ms average</div>
              </div>
            </div>
          </div>
        ))}
      </section>
      <section className="grid gap-3 rounded-xl border bg-card p-5 text-sm md:grid-cols-4">
        <div><div className="text-xs text-muted-foreground">Base model</div><div className="mt-1 font-medium">{run.assistantModel.provider} / {run.assistantModel.modelId}</div></div>
        <div><div className="text-xs text-muted-foreground">Tools and MCP</div><div className="mt-1">Knowledge search only; external actions disabled</div></div>
        <div><div className="text-xs text-muted-foreground">Data and memory</div><div className="mt-1">Knowledge live · {run.examples.filter((example) => example.inputs.history?.length).length} cases with history · {run.examples.filter((example) => example.inputs.memory?.length).length} with memory</div></div>
        <div><div className="text-xs text-muted-foreground">Orchestration</div><div className="mt-1">Ciele Flow runtime · stage {run.stage}</div></div>
      </section>
      <section>
        <h2 className="text-lg font-medium"><RollInText text="Model comparison" /></h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {METRICS.map((metric) => (
            <MetricChart key={metric.key} metric={metric} stats={stats} />
          ))}
        </div>
      </section>
      <EvaluationLeaderboard run={run} labels={labels} />
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-5 py-4">
          <h2 className="font-medium">Results by question</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Select a row to inspect answers and errors.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
              <tr>
                {[
                  "Question",
                  "Model",
                  "Accuracy",
                  "Flow",
                  "Latency",
                  "Token",
                  "Model cost",
                  "Error",
                ].map((head) => (
                  <th key={head} className="px-4 py-3 font-medium">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {run.results.map((result) => {
                const example = dataset.examples.find(
                  (item) => item.id === result.exampleId,
                );
                return (
                  <tr
                    key={`${result.exampleId}-${candidateKey(result.candidate)}`}
                    onClick={() => setSelected(result.exampleId)}
                    className={`cursor-pointer border-b last:border-0 hover:bg-muted/30 ${selected === result.exampleId ? "bg-muted/30" : ""}`}
                  >
                    <td
                      className="max-w-xs truncate px-4 py-3"
                      title={example?.inputs.question}
                    >
                      {example?.inputs.question ?? result.exampleId}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {result.candidate.modelId}
                    </td>
                    <td className="px-4 py-3">
                      {result.accuracy === null ? (
                        "—"
                      ) : result.accuracy ? (
                        <CheckCircle2 className="size-4 text-emerald-500" />
                      ) : (
                        <CircleAlert className="size-4 text-amber-500" />
                      )}
                    </td>
                    <td className="max-w-24 truncate px-4 py-3 text-xs">
                      {result.flowName ?? result.flowId ?? "—"}
                    </td>
                    <td className="px-4 py-3">{result.latencyMs} ms</td>
                    <td className="px-4 py-3">
                      {result.inputTokens + result.outputTokens}
                    </td>
                    <td className="px-4 py-3">{number(result.costEur, "€")}</td>
                    <td className="px-4 py-3 text-xs text-destructive">
                      {result.error ? "Yes" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {selectedExample && (
        <section className="rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-medium">{selectedExample.inputs.question}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedExample.id}
              </p>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {selectedResults.map((result) => (
              <div
                key={candidateKey(result.candidate)}
                className="rounded-lg border p-4"
              >
                <h3 className="text-sm font-medium">
                  {result.candidate.modelId}
                </h3>
                {result.error ? (
                  <p className="mt-3 text-sm text-destructive">
                    {result.error}
                  </p>
                ) : (
                  <p className="mt-3 whitespace-pre-wrap text-sm">
                    {result.answer || "No text answer"}
                  </p>
                )}
                {result.sourceUrls.length > 0 && (
                  <div className="mt-4 space-y-1 border-t pt-3 text-xs">
                    <div className="font-medium">Sources</div>
                    {result.sourceUrls.map((url) => (
                      <div
                        key={url}
                        className="truncate text-muted-foreground"
                        title={url}
                      >
                        {url}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            <strong>Reference:</strong>{" "}
            {JSON.stringify(selectedExample.reference_outputs)}
          </div>
        </section>
      )}
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Gauge className="mt-0.5 size-4 shrink-0" /> Accuracy is deterministic:
        it checks only reference_outputs fields. Autonomy means no
        fallback or error in the tested path; it does not measure the quality of the
        decision. Cost and tokens use model telemetry; retrieval
        may add cost to the organization ledger. The reranker uses
        estimated token counts.
      </p>
    </div>
  );
}
