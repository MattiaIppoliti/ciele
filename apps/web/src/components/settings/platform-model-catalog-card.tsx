"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Layers3, Search, Trash2 } from "lucide-react";
import { Badge, Button, Card, Input, Label } from "@agent-hub/ui";
import { modelSelector, type PlatformEvalModel } from "@agent-hub/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { RollInText } from "@/components/motion/roll-in-text";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { toast } from "@/lib/toast";
import {
  addPlatformModelAction,
  listDiscoverablePlatformModelsAction,
  removePlatformModelAction,
} from "@/app/actions";

type CatalogProvider = "anthropic" | "openai" | "google";
type CatalogOption = {
  provider: CatalogProvider;
  modelId: string;
  label: string;
  added: boolean;
};

export function PlatformModelCatalogCard({ models }: { models: PlatformEvalModel[] }) {
  const [provider, setProvider] = useState<CatalogProvider>("anthropic");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CatalogOption | null>(null);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  const [catalogError, setCatalogError] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  useEffect(() => {
    let cancelled = false;
    void listDiscoverablePlatformModelsAction()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setCatalogError(result.error);
          setCatalogStatus("error");
          return;
        }
        setCatalog(result.models);
        setCatalogStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setCatalogError("Could not load models.");
        setCatalogStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const search = query.trim().toLocaleLowerCase();
  const matches = search
    ? catalog.filter((model) =>
        model.provider === provider &&
        `${model.label} ${model.modelId}`.toLocaleLowerCase().includes(search),
      ).sort((a, b) => Number(a.added) - Number(b.added))
    : [];

  async function addModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || selected.added || busy) return;
    setBusy(true);
    const toastId = toast.show({ message: "Verifying model…", state: "pending" });
    try {
      const result = await addPlatformModelAction({
        provider: selected.provider,
        modelId: selected.modelId,
      });
      if (!result.ok) throw new Error(result.error);
      toast.show({ id: toastId, message: `${selected.label} added to the Ciele model catalog`, state: "success" });
      setCatalog((current) => current.map((model) =>
        model.provider === selected.provider && model.modelId === selected.modelId
          ? { ...model, added: true }
          : model,
      ));
      setQuery("");
      setSelected(null);
    } catch (cause) {
      toast.show({ id: toastId, message: cause instanceof Error ? cause.message : "Could not add the model.", state: "error" });
    } finally {
      setBusy(false);
    }
  }

  function removeModel(model: PlatformEvalModel) {
    confirmDelete({
      title: `Remove ${model.label}?`,
      description:
        "The model picker stops offering it. Assistants and Teammates already set to this model keep using it.",
      confirmLabel: "Remove",
      onConfirm: async () => {
        const result = await removePlatformModelAction({
          provider: model.provider,
          modelId: model.modelId,
        });
        if (!result.ok) throw new Error(result.error);
        setCatalog((current) => current.map((option) =>
          modelSelector(option) === modelSelector(model) ? { ...option, added: false } : option,
        ));
        toast.success(`${model.label} removed from the Ciele model catalog`);
      },
    });
  }

  return (
    <Card size="sm" className="mt-8 gap-0 p-4">
      {confirmDeleteModal}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <AnimatedIcon icon={Layers3} size={16} />
            Ciele model catalog
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Find a model in the Vercel AI Gateway catalog and add it for use across Ciele. Its official name and estimated token prices come from AI Gateway and are filled in automatically.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 rounded-full">Platform admin</Badge>
      </div>

      <form onSubmit={addModel} className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="catalog-provider">Provider</Label>
          <Select value={provider} onValueChange={(value) => {
            setProvider(value as CatalogProvider);
            setQuery("");
            setSelected(null);
          }}>
            <SelectTrigger id="catalog-provider" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="google">Google</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="catalog-search">Model</Label>
          <div className="relative">
            <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="catalog-search"
              type="search"
              className="pl-9"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(null);
              }}
              autoComplete="off"
              placeholder="Search by model name or ID"
              aria-describedby="catalog-search-help"
              disabled={catalogStatus !== "ready" || busy}
            />
          </div>
          <p id="catalog-search-help" className="text-xs text-muted-foreground">
            Select a model from the verified catalog. You don’t need to enter pricing or its display name.
          </p>
        </div>

        {catalogStatus === "loading" && <p role="status" className="text-sm text-muted-foreground">Loading available models…</p>}
        {catalogStatus === "error" && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 p-3 text-sm">
            <span>{catalogError}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              setCatalogStatus("loading");
              setReload((value) => value + 1);
            }}>Retry</Button>
          </div>
        )}

        {catalogStatus === "ready" && search && !selected && (
          <div aria-live="polite" className="rounded-lg border bg-background">
            {matches.length ? (
              <div className="max-h-56 overflow-y-auto p-1">
                {matches.slice(0, 8).map((model) => (
                  <button
                    key={modelSelector(model)}
                    type="button"
                    disabled={model.added}
                    onClick={() => {
                      setSelected(model);
                      setQuery(model.label);
                    }}
                    className="press-control flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium"><RollInText text={model.label} /></span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{model.modelId}</span>
                    </span>
                    {model.added && <span className="shrink-0 text-xs text-muted-foreground">Already available</span>}
                  </button>
                ))}
                {matches.length > 8 && <p className="px-3 py-2 text-xs text-muted-foreground">{matches.length - 8} more matches. Refine your search.</p>}
              </div>
            ) : <p className="px-3 py-4 text-sm text-muted-foreground">No matching text models. Try another name or ID.</p>}
          </div>
        )}

        {selected && (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <div className="font-medium">{selected.label}</div>
              <div className="break-all font-mono text-xs text-muted-foreground">{selected.provider}/{selected.modelId}</div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="max-w-sm text-xs text-muted-foreground">
            Adding a model does not connect a provider. Each organization still needs its own provider access.
          </p>
          <Button type="submit" disabled={!selected || busy}>
            <RollInText text={busy ? "Verifying…" : "Add model"} />
          </Button>
        </div>
      </form>

      <div className="mt-6 border-t pt-4">
        <h3 className="text-sm font-medium">Added models</h3>
        {models.length ? (
          <div className="mt-2 divide-y">
            {models.map((model) => (
              <div key={modelSelector(model)} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <div className="font-medium"><RollInText text={model.label} /></div>
                  <div className="break-all font-mono text-xs text-muted-foreground">{model.provider}/{model.modelId}</div>
                </div>
                <div className="col-start-1 text-xs text-muted-foreground sm:col-start-auto sm:text-right">
                  <div>Input €{model.inputEurPerMillion}/1M</div>
                  <div>Output €{model.outputEurPerMillion}/1M</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeModel(model)}
                  aria-label={`Remove ${model.label}`}
                  className="col-start-2 row-start-1 text-muted-foreground hover:text-destructive sm:col-start-auto sm:row-start-auto"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : <p className="mt-2 text-sm text-muted-foreground">No models added yet.</p>}
      </div>
    </Card>
  );
}
