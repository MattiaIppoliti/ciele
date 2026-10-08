"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@agent-hub/ui";
import { modelSelector, type Teammate } from "@agent-hub/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveTeammateDefaultModelAction } from "@/app/actions";
import type { EvaluationModelOption } from "@/lib/evaluation-models";
import { toast } from "@/lib/toast";

type TeammateOption = Pick<Teammate, "id" | "name" | "modelProvider" | "modelId">;

export function TeammateDefaultModelSettings({ teammates, models }: {
  teammates: TeammateOption[];
  models: EvaluationModelOption[];
}) {
  const router = useRouter();
  const [teammateId, setTeammateId] = useState(teammates[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const teammate = teammates.find(item => item.id === teammateId);
  const current = teammate ? modelSelector({ provider: teammate.modelProvider, modelId: teammate.modelId }) : "";
  async function save(key: string) {
    const model = models.find(item => modelSelector(item) === key);
    if (!model || !teammate) return;
    setSaving(true);
    try {
      const result = await saveTeammateDefaultModelAction({ teammateId, model: { provider: model.provider, modelId: model.modelId } });
      if (!result.ok) throw new Error(result.error);
      toast.show({ message: "Default model saved", state: "success" });
      router.refresh();
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : "Could not save the default model.", state: "error" });
    } finally { setSaving(false); }
  }
  return <section className="mt-4 rounded-xl border bg-card p-4 shadow-light">
    <h2 className="text-lg font-medium">Teammate default model</h2>

    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1.5"><Label>Teammate</Label><Select value={teammateId} onValueChange={setTeammateId} disabled={saving || !teammates.length}>
        <SelectTrigger aria-label="Default model Teammate"><SelectValue placeholder="No editable Teammates" /></SelectTrigger>
        <SelectContent>{teammates.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
      </Select></div>
      <div className="space-y-1.5"><Label>Model</Label><Select value={current} onValueChange={value => { void save(value); }} disabled={saving || !teammate || !models.length}>
        <SelectTrigger aria-label="Teammate default runtime model"><SelectValue placeholder="No connected models" /></SelectTrigger>
        <SelectContent>{current && !models.some(item => modelSelector(item) === current) && <SelectItem value={current} disabled>{teammate?.modelId} · Unavailable</SelectItem>}{models.map(item => <SelectItem key={modelSelector(item)} value={modelSelector(item)}>{item.label} · {item.providerName}</SelectItem>)}</SelectContent>
      </Select></div>
    </div>
  </section>;
}
