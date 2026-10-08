"use client";

import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Label } from "@agent-hub/ui";
import { evaluationLeaderboard, modelSelector, recommendedEvaluationModel, type EvaluationCandidate, type EvaluationRun, type EvaluationStage } from "@agent-hub/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { evaluationDefaultContextAction, saveEvaluationDefaultAction } from "@/app/actions";
import type { EvaluationModelOption } from "@/lib/evaluation-models";
import { Table } from "@/components/motion/table";
import { toast } from "@/lib/toast";

const stages: { value: EvaluationStage; label: string }[] = [
  { value: "answer", label: "Answer" }, { value: "classifier", label: "Classifier" },
  { value: "orchestration", label: "Orchestration" }, { value: "fallback", label: "Fallback" },
  { value: "preflight", label: "Pre-flight" }, { value: "reranker", label: "Reranker" },
];

type AssistantOption = { id: string; title: string; modelsByStage: Record<EvaluationStage, EvaluationModelOption[]> };
export function DefaultModelSettings({ assistants, canEdit }: {
  assistants: AssistantOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [assistantId, setAssistantId] = useState(assistants[0]?.id ?? "");
  const [stage, setStage] = useState<EvaluationStage>("answer");
  const [context, setContext] = useState<{ current: EvaluationCandidate | null; run: EvaluationRun | null; recentRuns: EvaluationRun[] } | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(Boolean(assistantId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const models = assistants.find(item => item.id === assistantId)?.modelsByStage[stage] ?? [];
  useEffect(() => {
    let disposed = false;
    if (!assistantId) return;
    evaluationDefaultContextAction(assistantId, stage).then(value => {
      if (disposed) return;
      setContext(value); setSelected(value.current ? modelSelector(value.current) : "");
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not load the default model."); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [assistantId, stage, revision]);
  function resetContext() {
    setContext(null); setSelected(""); setError(null); setLoading(true);
  }
  const recommended = recommendedEvaluationModel(context?.run ?? null, assistantId, stage, models);
  const current = context?.current;
  async function save(key = selected) {
    const model = models.find(item => modelSelector(item) === key);
    if (!model) return;
    setSaving(true);
    try {
      const result = await saveEvaluationDefaultAction({ assistantId, stage, model: { provider: model.provider, modelId: model.modelId } });
      if (!result.ok) throw new Error(result.error);
      toast.show({ message: "Default model saved", state: "success" });
      resetContext(); setRevision(value => value + 1); router.refresh();
    } catch (cause) { setSelected(current ? modelSelector(current) : ""); toast.show({ message: cause instanceof Error ? cause.message : "Could not save the default model.", state: "error" }); }
    finally { setSaving(false); }
  }
  return <section className="mt-8 rounded-xl border bg-card p-4 shadow-light">
    <h2 className="text-lg font-medium">Default model</h2>

    <div className="grid gap-4 @xl/settings:grid-cols-3">
      <div className="space-y-1.5"><Label>Assistant</Label><Select value={assistantId} onValueChange={value => { resetContext(); setAssistantId(value); }} disabled={saving || !assistants.length}><SelectTrigger aria-label="Default model Assistant"><SelectValue placeholder="Choose an Assistant" /></SelectTrigger><SelectContent>{assistants.map(item => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Stage</Label><Select value={stage} onValueChange={value => { resetContext(); setStage(value as EvaluationStage); }} disabled={saving}><SelectTrigger aria-label="Default model stage"><SelectValue /></SelectTrigger><SelectContent>{stages.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Model</Label><Select value={models.some(item => modelSelector(item) === selected) ? selected : ""} onValueChange={value => { setSelected(value); void save(value); }} disabled={!canEdit || loading || saving || !models.length}><SelectTrigger aria-label="Default runtime model"><SelectValue placeholder={loading ? "Loading…" : models.length ? "Choose a model" : "No connected models"} /></SelectTrigger><SelectContent>{models.map(item => <SelectItem key={modelSelector(item)} value={modelSelector(item)}>{item.label}{recommended && modelSelector(recommended.candidate) === modelSelector(item) ? " · Recommended" : ""}</SelectItem>)}</SelectContent></Select></div>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-5">
      <h3 className="text-sm font-medium">Recent runs · {stages.find(item => item.value === stage)?.label}</h3>
      {loading ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p> : !context?.recentRuns.length ?
        <p className="mt-2 text-sm text-muted-foreground">No runs yet.</p> :
        <div className="mt-2"><Table key={`${assistantId}:${stage}`} noun="model result"
          data={context.recentRuns.flatMap(run => evaluationLeaderboard(run).rows.map(row => ({ run, row })))}
          getRowId={({ run, row }) => `${run.id}:${modelSelector(row.candidate)}`}
          searchValue={({ run, row }) => `${run.datasetName} ${row.candidate.modelId} ${run.status}`}
          columns={[
            { key: "run", header: "Run", accessor: ({ run }) => run.createdAt, sortable: true, cell: ({ run }) => <><Link href={`/eval/${run.id}`} className="text-brand-ink hover:underline">{new Date(run.createdAt).toLocaleDateString("en-GB")}</Link><div className="text-xs text-muted-foreground">{run.datasetName}</div></> },
            { key: "status", header: "Status", accessor: ({ run }) => run.status, filterLabel: "Status", filterAnyLabel: "All statuses",
              filterOptions: ["completed", "failed", "running"].map(value => ({ value, label: value })),
              cell: ({ run }) => <StatusPill status={run.status === "completed" ? "online" : run.status === "failed" ? "error" : run.status === "running" ? "info" : "away"} animated={run.status === "running"} primaryText={run.status} /> },
            { key: "model", header: "Model", accessor: ({ row }) => models.find(item => modelSelector(item) === modelSelector(row.candidate))?.label ?? row.candidate.modelId, sortable: true },
            { key: "accuracy", header: "Accuracy", accessor: ({ row }) => row.accuracy, cell: ({ row }) => row.accuracy === null ? "—" : `${Math.round(row.accuracy * 100)}%`, sortable: true, align: "right" },
            { key: "cost", header: "€ / 1,000", accessor: ({ row }) => row.eurPer1000, cell: ({ row }) => row.eurPer1000.toFixed(2), sortable: true, align: "right" },
            { key: "median", header: "Median", accessor: ({ row }) => row.medianMs, cell: ({ row }) => row.medianMs === null ? "—" : `${Math.round(row.medianMs)} ms`, sortable: true, align: "right" },
          ]} emptyState="No model results yet." /></div>}

    </div>
  </section>;
}
