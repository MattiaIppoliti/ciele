"use client";

import { useRef, useState, useTransition, type PointerEvent } from "react";
import { Link } from "@/components/ui/link";
import type { Flow, FlowTrust } from "@agent-hub/core";
import {
  GripVertical,
  Lock,
  Pencil,
  Plus,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { reorderFlowsAction, updateFlowAction } from "@/app/actions";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Card } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { Switch } from "@/components/ui/switch";
import { FLOW_ACTIONS } from "@/lib/flow-actions";
import { moveFlowId } from "@/lib/flow-order";
import { TrustBadge } from "@/components/assistant/trust-badge";

function ActionChips({ flow }: { flow: Flow }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {flow.actions.map((action) => {
        const meta = FLOW_ACTIONS[action];
        if (!meta) return null;
        const Icon = meta.icon;
        return (
          <Badge
            key={action}
            variant="outline"
            className="text-foreground/80 h-7 rounded-md px-2.5 font-medium"
          >
            <AnimatedIcon icon={Icon} size={14} />
            {meta.label}
          </Badge>
        );
      })}
    </div>
  );
}

export function FlowsList({
  assistantId,
  flows,
  trust = [],
}: {
  assistantId: string;
  flows: Flow[];
  /** Materialized trust rows for this assistant's flows (may be empty). */
  trust?: FlowTrust[];
}) {
  const [isPending, startTransition] = useTransition();
  const propOrderable = flows.filter((f) => !f.isDefault);
  const [orderedIds, setOrderedIds] = useState(() =>
    propOrderable.map((flow) => flow.id)
  );
  const orderedIdsRef = useRef(orderedIds);
  const dragStartOrderRef = useRef<string[] | null>(null);
  const byId = new Map(propOrderable.map((flow) => [flow.id, flow]));
  const orderable = [
    ...orderedIds
      .map((id) => byId.get(id))
      .filter((flow): flow is Flow => Boolean(flow)),
    ...propOrderable.filter((flow) => !orderedIds.includes(flow.id)),
  ];
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const defaultFlow = flows.find((f) => f.isDefault);

  function setOrder(next: string[]) {
    orderedIdsRef.current = next;
    setOrderedIds(next);
  }

  function persistOrder(next: string[], previous: string[]) {
    setOrder(next);
    startTransition(async () => {
      try {
        await reorderFlowsAction(assistantId, next);
        toast.success("Flow priority updated");
      } catch {
        setOrder(previous);
        toast.error("Could not update flow priority");
      }
    });
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= orderable.length) return;
    const previous = orderable.map((flow) => flow.id);
    const next = [...previous];
    [next[index], next[target]] = [next[target], next[index]];
    persistOrder(next, previous);
  }

  function beginDrag(event: PointerEvent<HTMLButtonElement>, flowId: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartOrderRef.current = [...orderedIdsRef.current];
    setDraggedId(flowId);
  }

  function updateDrag(event: PointerEvent<HTMLButtonElement>, flowId: string) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-flow-id]")
      ?.dataset.flowId;
    if (!target) return;
    const next = moveFlowId(orderedIdsRef.current, flowId, target);
    if (next !== orderedIdsRef.current) setOrder(next);
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const previous = dragStartOrderRef.current;
    dragStartOrderRef.current = null;
    setDraggedId(null);
    if (!previous) return;
    const next = orderedIdsRef.current;
    if (next.join("|") !== previous.join("|")) persistOrder(next, previous);
  }

  function cancelDrag(event: PointerEvent<HTMLButtonElement>) {
    const previous = dragStartOrderRef.current;
    dragStartOrderRef.current = null;
    setDraggedId(null);
    if (previous) setOrder(previous);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function toggle(flow: Flow, enabled: boolean) {
    startTransition(async () => {
      await updateFlowAction(assistantId, flow.id, { enabled });
      toast.success(`"${flow.name}" ${enabled ? "enabled" : "disabled"}`);
    });
  }

  return (
    <div className={isPending ? "pointer-events-none opacity-70" : ""}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Flows</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Drag flows to set priority. The first matching flow wins.
          </p>
        </div>
        <Button
          render={<Link href={`/assistants/${assistantId}/flows/new`} />}
          nativeButton={false}
          className="px-5 font-semibold"
        >
          <AnimatedIcon icon={Plus} size={16} /> New flow
        </Button>
      </div>

      <div className="mt-6 space-y-4">
        {orderable.map((flow, i) => (
          <Card
            size="sm"
            key={flow.id}
            data-flow-id={flow.id}
            className={`flex-row gap-3 p-4 transition-colors ${
              draggedId === flow.id
                ? "bg-muted/50 opacity-60 ring-2 ring-primary/50"
                : draggedId
                  ? "ring-primary/20"
                  : ""
            }`}
          >
            <Hint label="Drag to change priority">
              <button
                type="button"
                aria-label={`Drag ${flow.name} to change its priority`}
                onPointerDown={(event) => beginDrag(event, flow.id)}
                onPointerMove={(event) => updateDrag(event, flow.id)}
                onPointerUp={finishDrag}
                onPointerCancel={cancelDrag}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp") move(i, -1);
                  if (event.key === "ArrowDown") move(i, 1);
                }}
                className="text-muted-foreground/60 hover:text-foreground mt-0.5 flex h-9 w-7 shrink-0 touch-none select-none items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[dragging=true]:cursor-grabbing md:cursor-grab"
                data-dragging={draggedId === flow.id}
              >
                <GripVertical className="size-5" />
              </button>
            </Hint>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">{flow.name}</h2>
                {flow.builtIn && (
                  <Badge
                    variant="outline"
                    className="text-muted-foreground rounded-full"
                  >
                    Built-in
                  </Badge>
                )}
                {(() => {
                  const flowTrust = trust.find((t) => t.flowId === flow.id);
                  if (flowTrust) return <TrustBadge trust={flowTrust} />;
                  // Only generative flows are graded, so only they carry a
                  // meaningful tier — badge those with no history as watch.
                  const generative =
                    flow.isDefault || flow.actions.includes("search_knowledge");
                  return generative ? <TrustBadge trust={null} /> : null;
                })()}
              </div>
              <p className="text-muted-foreground mt-1 truncate text-sm">
                {flow.description}
              </p>
              <ActionChips flow={flow} />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Hint label="Edit flow">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit flow"
                  render={
                    <Link href={`/assistants/${assistantId}/flows/${flow.id}`} />
                  }
                  nativeButton={false}
                >
                  <Pencil className="size-4" />
                </Button>
              </Hint>
              <Switch
                checked={flow.enabled}
                onCheckedChange={(checked) => toggle(flow, checked)}
                aria-label={`Toggle ${flow.name}`}
              />
            </div>
          </Card>
        ))}

        <Link
          href={`/assistants/${assistantId}/flows/new`}
          className="text-muted-foreground hover:bg-muted/50 hover:text-foreground flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3.5 text-sm font-medium transition-colors"
        >
          <AnimatedIcon icon={Plus} size={16} /> Create new flow
        </Link>

        {defaultFlow && (
          <Card size="sm" className="mt-8 flex-row gap-3 p-4">
            <AnimatedIcon
              icon={Lock}
              size={20}
              iconClassName="text-muted-foreground/70"
              className="mt-1 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">{defaultFlow.name}</h2>
                <Badge
                  variant="outline"
                  className="text-muted-foreground rounded-full"
                >
                  Always last
                </Badge>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                {defaultFlow.description}
              </p>
              <ActionChips flow={defaultFlow} />
            </div>
            <Hint label="Edit default behavior">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit default behavior"
                className="shrink-0"
                render={
                  <Link
                    href={`/assistants/${assistantId}/flows/${defaultFlow.id}`}
                  />
                }
                nativeButton={false}
              >
                <Pencil className="size-4" />
              </Button>
            </Hint>
          </Card>
        )}
      </div>
    </div>
  );
}
