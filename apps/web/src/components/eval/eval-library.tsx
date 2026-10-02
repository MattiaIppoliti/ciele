"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import { ArrowRight, Download, Upload } from "lucide-react";
import { Button, Input, Label } from "@agent-hub/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/motion/tabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { toast } from "@/lib/toast";
import { EVALUATION_STAGES, modelSelector } from "@agent-hub/core";
import type {
  EvaluationDataset,
  EvaluationRun,
  EvaluationStage,
  Provider,
} from "@agent-hub/core";
import type { EvaluationModelOption } from "@/lib/evaluation-models";
import {
  createEvaluationDatasetAction,
  startEvaluationRunAction,
} from "@/app/actions";

const STAGE_COPY: Record<EvaluationStage, { label: string; detail: string }> = {
  answer: { label: "Answer", detail: "Answer, sources, and quality of the selected model" },
  classifier: { label: "Classifier", detail: "Flow selected by the classifier" },
  orchestration: { label: "Orchestration", detail: "Routing and response of the entire turn" },
  fallback: { label: "Fallback", detail: "Quality of the fallback response candidate" },
  preflight: { label: "Pre-flight", detail: "Pre-flight decision and confidence" },
  reranker: { label: "Reranker", detail: "Source quality in the top six results" },
};
const STAGES = EVALUATION_STAGES.map((value) => ({ value, ...STAGE_COPY[value] }));
type AssistantOption = {
  id: string;
  title: string;
  modelProvider: Provider;
  modelId: string;
  modelsByStage: Record<EvaluationStage, EvaluationModelOption[]>;
};

const modelKey = modelSelector;

function defaultCandidates(
  stage: EvaluationStage,
  assistant: AssistantOption | undefined,
): string[] {
  return (assistant?.modelsByStage[stage] ?? [])
    .slice(0, 2)
    .map(modelKey);
}
const EXAMPLE = [
  {
    id: "q-001",
    inputs: {
      question: "How long does delivery take?",
      launch_url: "https://example.org/shipping",
    },
    reference_outputs: {
      answer_contains: ["3 business days"],
      source_url_contains: ["/shipping"],
    },
  },
  {
    id: "q-002",
    inputs: { question: "I would like to speak to a person" },
    reference_outputs: { flow_name: "Contact support" },
  },
];
function downloadExample() {
  const blob = new Blob([JSON.stringify(EXAMPLE, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ciele-eval-dataset.example.json";
  link.click();
  URL.revokeObjectURL(url);
}
function fmtDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function fmtCost(value: number) {
  return `€${value.toFixed(4)}`;
}

export function EvalLibrary({
  runs,
  datasets,
  assistants,
  allModels,
  availableModelKeys,
  canEdit,
  canManageProviders,
  canManageCatalog,
  page,
  hasNext,
}: {
  runs: EvaluationRun[];
  datasets: EvaluationDataset[];
  assistants: AssistantOption[];
  allModels: EvaluationModelOption[];
  availableModelKeys: string[];
  canEdit: boolean;
  canManageProviders: boolean;
  canManageCatalog: boolean;
  page: number;
  hasNext: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"runs" | "datasets" | "models">("runs");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [assistantId, setAssistantId] = useState(assistants[0]?.id ?? "");
  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? "");
  const [stage, setStage] = useState<EvaluationStage>("answer");
  const [candidateKeys, setCandidateKeys] = useState(() =>
    defaultCandidates("answer", assistants[0]),
  );
  const [busy, setBusy] = useState(false);
  const stageModels =
    assistants.find((assistant) => assistant.id === assistantId)?.modelsByStage[stage] ?? [];
  const selectedModels = stageModels.filter((model) => candidateKeys.includes(modelKey(model)));
  const modelGroups = [...new Set(stageModels.map((model) => model.providerName))];

  async function upload() {
    if (!file || !name.trim()) return;
    setBusy(true);
    const toastId = toast.show({ message: "Uploading dataset…", state: "pending" });
    try {
      const content = JSON.parse(await file.text()) as unknown;
      const examples = Array.isArray(content)
        ? content
        : (content as { examples?: unknown })?.examples;
      const saved = await createEvaluationDatasetAction({ name, examples });
      if (!saved.ok) throw new Error(saved.error);
      toast.show({ id: toastId, message: `Dataset “${name.trim()}” uploaded`, state: "success" });
      setName("");
      setFile(null);
      setDatasetId(saved.id);
      setTab("datasets");
    } catch (cause) {
      toast.show({ id: toastId, message: cause instanceof Error ? cause.message : "Invalid JSON.", state: "error" });
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    setBusy(true);
    const toastId = toast.show({ message: "Evaluation running…", state: "pending" });
    try {
      const candidates = selectedModels.map(({ provider, modelId }) => ({ provider, modelId }));
      const data = await startEvaluationRunAction({ assistantId, datasetId, stage, candidates });
      if (!data.ok) throw new Error(data.error);
      toast.show({
        id: toastId,
        message: data.status === "failed" ? (data.error ?? "Evaluation failed. Open the run for details.") : "Evaluation completed. Opening results…",
        state: data.status === "failed" ? "error" : "success",
      });
      router.push(`/eval/${data.id}`);
    } catch (cause) {
      toast.show({ id: toastId, message: cause instanceof Error ? cause.message : "Unexpected error.", state: "error" });
    } finally {
      setBusy(false);
    }
  }
  const datasetNames = new Map(
    datasets.map((dataset) => [dataset.id, dataset.name]),
  );
  const assistantNames = new Map(
    assistants.map((assistant) => [assistant.id, assistant.title]),
  );
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <h1 className="sr-only">Eval</h1>
      <Tabs value={tab} onValueChange={(value) => setTab(value as "runs" | "datasets" | "models")}>
        <TabsList aria-label="Eval tabs">
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="datasets">Datasets</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
        </TabsList>
        <TabsContent value="runs" className="space-y-6">
          {canEdit && (
            <section className="rounded-xl border bg-card p-5 shadow-light">
              <h2 className="text-lg font-medium">New experiment</h2>
              <p className="mb-5 mt-1 text-sm text-muted-foreground">
                Each model receives the same examples. Up to 24 evaluations
                per run.
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="eval-assistant">Assistant</Label>
                  <Select
                    value={assistantId}
                    onValueChange={(value) => {
                      setAssistantId(value);
                      setCandidateKeys(
                        defaultCandidates(
                          stage,
                          assistants.find(
                            (assistant) => assistant.id === value,
                          ),
                        ),
                      );
                    }}
                  >
                    <SelectTrigger id="eval-assistant" className="w-full">
                      <SelectValue placeholder="Select an assistant" />
                    </SelectTrigger>
                    <SelectContent>
                      {assistants.map((assistant) => (
                        <SelectItem key={assistant.id} value={assistant.id}>
                          {assistant.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="eval-dataset">Dataset</Label>
                  <Select
                    value={datasetId}
                    onValueChange={setDatasetId}
                    disabled={!datasets.length}
                  >
                    <SelectTrigger id="eval-dataset" className="w-full">
                      <SelectValue placeholder="Upload a dataset" />
                    </SelectTrigger>
                    <SelectContent>
                      {datasets.map((dataset) => (
                        <SelectItem key={dataset.id} value={dataset.id}>
                          {dataset.name} · {dataset.examples.length} examples
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="eval-stage">Stage to evaluate</Label>
                  <Select
                    value={stage}
                    onValueChange={(value) => {
                      const next = value as EvaluationStage;
                      setStage(next);
                      setCandidateKeys(
                        defaultCandidates(
                          next,
                          assistants.find(
                            (assistant) => assistant.id === assistantId,
                          ),
                        ),
                      );
                    }}
                  >
                    <SelectTrigger id="eval-stage" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGES.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {STAGES.find((item) => item.value === stage)?.detail}
              </p>
              <div className="mt-4 max-w-2xl space-y-1.5">
                <Label htmlFor="eval-models">Models to compare (2–3)</Label>
                <Select
                  multiple
                  value={candidateKeys}
                  disabled={!stageModels.length}
                  onValueChange={(keys) => {
                    if (keys.length <= 3) setCandidateKeys(keys);
                  }}
                >
                  <SelectTrigger id="eval-models" className="w-full">
                    <SelectValue placeholder="Select models">
                      {selectedModels.length
                        ? selectedModels.map((model) => model.label).join(" · ")
                        : "Select models"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {modelGroups.map((group) => (
                      <SelectGroup key={group} aria-label={group}>
                        <SelectGroupLabel>{group}</SelectGroupLabel>
                        {stageModels.filter((model) => model.providerName === group).map((model) => {
                          const key = modelKey(model);
                          return (
                            <SelectItem
                              key={key}
                              value={key}
                              disabled={candidateKeys.length >= 3 && !candidateKeys.includes(key)}
                            >
                              {model.label}
                            </SelectItem>
                          );
                        })}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {stageModels.length < 2
                    ? "At least two models must be configured for this stage."
                    : selectedModels.length < 2
                      ? "Choose at least two models to start the comparison."
                      : <><RollingNumber value={selectedModels.length} /> models ready to compare.</>}
                  {" "}<button type="button" onClick={() => setTab("models")} className="text-brand-ink press-text underline-offset-4 hover:underline">View all models</button>
                  {(canManageProviders || canManageCatalog) && (
                    <> · <Link href="/settings/ai" className="text-brand-ink press-text underline-offset-4 hover:underline">AI Provider settings</Link></>
                  )}
                </p>
              </div>
              <Button
                disabled={busy || !assistantId || !datasetId || selectedModels.length < 2}
                onClick={run}
                className="mt-4"
              >
                <RollInText text={busy ? "Evaluating…" : "Start run"} />
              </Button>
            </section>
          )}
          <section className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b px-5 py-4">
              <h2 className="font-medium">Recent runs</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    {[
                      "Date",
                      "Assistant",
                      "Dataset",
                      "Stage",
                      "Models",
                      "Accuracy",
                      "Model cost",
                      "Status",
                      "",
                    ].map((head) => (
                      <th key={head} className="px-4 py-3 font-medium">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const graded = run.results.filter(
                      (result) => result.accuracy !== null,
                    );
                    const accuracy = graded.length
                      ? Math.round(
                          (100 *
                            graded.filter((result) => result.accuracy).length) /
                            graded.length,
                        ) + "%"
                      : "—";
                    return (
                      <tr
                        key={run.id}
                        onClick={() => router.push(`/eval/${run.id}`)}
                        className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                      >
                        <td className="whitespace-nowrap px-4 py-3">
                          {fmtDate(run.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          {assistantNames.get(run.assistantId) ??
                            run.assistantName}
                        </td>
                        <td className="px-4 py-3">
                          {datasetNames.get(run.datasetId) ?? run.datasetName}
                        </td>
                        <td className="px-4 py-3 capitalize">{run.stage}</td>
                        <td className="px-4 py-3">{run.candidates.length}</td>
                        <td className="px-4 py-3">{accuracy}</td>
                        <td className="px-4 py-3">
                          {fmtCost(
                            run.results.reduce(
                              (sum, result) => sum + result.costEur,
                              0,
                            ),
                          )}
                        </td>
                        <td className="px-4 py-3"><StatusPill
                          status={run.status === "completed" ? "online" : run.status === "failed" ? "error" : run.status === "running" ? "info" : "away"}
                          animated={run.status === "running"}
                          primaryText={run.status}
                        /></td>
                        <td className="px-4 py-3">
                          <ArrowRight className="size-4" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!runs.length && (
                <EmptyState title="No runs yet" description="Upload a dataset and start your first comparison." />
              )}
            </div>
            <div className="flex items-center justify-end gap-4 border-t px-5 py-3 text-xs">
              <span>Page {page}</span>
              {page > 1 && (
                <Link
                  href={`/eval?page=${page - 1}`}
                  className="text-primary hover:underline"
                >
                  Previous
                </Link>
              )}
              {hasNext && (
                <Link
                  href={`/eval?page=${page + 1}`}
                  className="text-primary hover:underline"
                >
                  Next
                </Link>
              )}
            </div>
          </section>
        </TabsContent>
        <TabsContent value="datasets">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b px-5 py-4">
              <h2 className="font-medium">Datasets</h2>
            </div>
            {datasets.map((dataset) => (
              <div
                key={dataset.id}
                className="flex items-center justify-between border-b px-5 py-4 text-sm last:border-0"
              >
                <div>
                  <div className="font-medium">{dataset.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {fmtDate(dataset.createdAt)}
                  </div>
                </div>
                <span className="text-muted-foreground">
                  <RollingNumber value={dataset.examples.length} /> examples
                </span>
              </div>
            ))}
            {!datasets.length && (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                No datasets uploaded.
              </p>
            )}
          </section>
          <section className="h-fit rounded-xl border bg-card p-5">
            <h2 className="font-medium">Upload dataset</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              A JSON file containing an array of examples. Each example needs a unique ID
              and <code>inputs.question</code>. In <code>reference_outputs</code>{" "}
              you can specify expected text, Flow name or ID, and source URLs:
              only these criteria affect accuracy.{" "}
              <code>inputs.history</code> and <code>inputs.memory</code> simulate
              chat context.
            </p>
            <button
              onClick={downloadExample}
              className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <Download className="size-4" /> Download example format
            </button>
            {canEdit && (
              <div className="mt-5 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="eval-dataset-name">Name</Label>
                  <Input
                    id="eval-dataset-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Returns · September"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="eval-dataset-file">File JSON</Label>
                  <Input
                    id="eval-dataset-file"
                    type="file"
                    accept=".json,application/json"
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                </div>
                <Button
                  disabled={busy || !name.trim() || !file}
                  onClick={upload}
                >
                  <Upload className="size-4" /> <RollInText text={busy ? "Uploading…" : "Upload"} />
                </Button>
              </div>
            )}
          </section>
        </div>
        </TabsContent>
        <TabsContent value="models" className="space-y-5">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="text-lg font-medium">Model catalog</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              These models can be selected in Eval. A model is available through
              the organization’s AI connections or through AI Gateway.
            </p>
            {(canManageProviders || canManageCatalog) ? (
              <Link href="/settings/ai" className="mt-3 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                Open AI Provider settings <ArrowRight className="size-4" />
              </Link>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                An organization admin can configure Provider Connections in Settings → AI Provider.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              A Ciele platform admin can add verified chat models in Settings → AI Provider.
            </p>
          </section>
          <div className="grid gap-4 md:grid-cols-2">
            {[...new Set(allModels.map((model) => model.providerName))].map((providerName) => (
              <section key={providerName} className="rounded-xl border bg-card p-5">
                <h3 className="font-medium">{providerName}</h3>
                <div className="mt-3 divide-y">
                  {allModels.filter((model) => model.providerName === providerName).map((model) => {
                    const available = availableModelKeys.includes(modelKey(model));
                    return (
                      <div key={modelKey(model)} className="flex items-center justify-between gap-3 py-3 text-sm">
                        <div className="min-w-0">
                          <div className="font-medium">{model.label}{model.platformAdded && <span className="ml-2 text-xs font-normal text-muted-foreground">Added by Ciele</span>}</div>
                          <div className="truncate font-mono text-xs text-muted-foreground" title={model.modelId}>{model.modelId}</div>
                          {model.platformAdded && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Input €{model.inputEurPerMillion}/1M · Output €{model.outputEurPerMillion}/1M
                            </div>
                          )}
                        </div>
                        <StatusPill
                          status={available ? "online" : "offline"}
                          primaryText={available ? "Available" : "Configure provider"}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
