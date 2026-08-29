"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
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
import {
  SortableHandle,
  SortableItem,
  SortableList,
} from "@/components/ui/sortable-list";
import { FLOW_ACTIONS, FLOW_TRIGGER_LABELS } from "@/lib/flow-actions";
import { TrustBadge } from "@/components/assistant/trust-badge";
import { moveOrderedId } from "@/lib/list-order";

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
  const persistInFlightRef = useRef(false);
  const byId = new Map(propOrderable.map((flow) => [flow.id, flow]));
  const orderable = [
    ...orderedIds
      .map((id) => byId.get(id))
      .filter((flow): flow is Flow => Boolean(flow)),
    ...propOrderable.filter((flow) => !orderedIds.includes(flow.id)),
  ];
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const defaultFlow = flows.find((f) => f.isDefault);

  function setOrder(next: string[]) {
    orderedIdsRef.current = next;
    setOrderedIds(next);
  }

  function persistOrder(next: string[], previous: string[]) {
    if (persistInFlightRef.current) return;
    persistInFlightRef.current = true;
    setOrder(next);
    startTransition(async () => {
      try {
        await reorderFlowsAction(assistantId, next);
        toast.success("Flow priority updated");
      } catch {
        setOrder(previous);
        toast.error("Could not update flow priority");
      } finally {
        persistInFlightRef.current = false;
      }
    });
  }

  function move(index: number, delta: -1 | 1) {
    if (isPending || persistInFlightRef.current) return;
    const target = index + delta;
    if (target < 0 || target >= orderable.length) return;
    const previous = orderable.map((flow) => flow.id);
    const next = moveOrderedId(previous, previous[index]!, previous[target]!);
    setReorderAnnouncement(
      `${orderable[index]!.name} moved to position ${target + 1} of ${orderable.length}`
    );
    persistOrder(next, previous);
  }

  function beginDrag(flowId: string) {
    dragStartOrderRef.current = [...orderedIdsRef.current];
    setDraggedId(flowId);
  }

  function finishDrag() {
    const previous = dragStartOrderRef.current;
    dragStartOrderRef.current = null;
    setDraggedId(null);
    if (!previous) return;
    const next = orderedIdsRef.current;
    if (next.join("|") !== previous.join("|")) persistOrder(next, previous);
  }

  function toggle(flow: Flow, enabled: boolean) {
    startTransition(async () => {
      await updateFlowAction(assistantId, flow.id, { enabled });
      toast.success(`"${flow.name}" ${enabled ? "enabled" : "disabled"}`);
    });
  }

  return (
    <div className={isPending ? "pointer-events-none opacity-70" : ""}>
      <p className="sr-only" aria-live="polite">{reorderAnnouncement}</p>
      <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
        <Button
          render={<Link href={`/assistants/${assistantId}/flows/new`} />}
          nativeButton={false}
          className="px-5 font-semibold"
        >
          <AnimatedIcon icon={Plus} size={16} /> New flow
        </Button>
      </div>

      <div className="mt-6 space-y-4">
        <SortableList
          values={orderedIds}
          onReorder={setOrder}
          className="space-y-4"
        >
          {orderable.map((flow, i) => (
            <SortableItem
              key={flow.id}
              value={flow.id}
              onDragStart={() => beginDrag(flow.id)}
              onDragEnd={finishDrag}
            >
              <Card
                size="sm"
                className={`flex-row gap-3 p-4 transition-[background-color,box-shadow,opacity] ${
                  draggedId === flow.id
                    ? "bg-muted/50 ring-primary/50 ring-2"
                    : draggedId
                      ? "ring-primary/20"
                      : ""
                }`}
              >
                <Hint label="Drag to change priority">
                  <SortableHandle
                    aria-label={`Drag ${flow.name} to change its priority`}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        move(i, -1);
                      }
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        move(i, 1);
                      }
                    }}
                    className="text-muted-foreground/60 hover:text-foreground mt-0.5 flex h-9 w-7 shrink-0 touch-none select-none items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[dragging=true]:cursor-grabbing md:cursor-grab"
                    data-dragging={draggedId === flow.id}
                  >
                    <GripVertical className="size-5" />
                  </SortableHandle>
                </Hint>
                <div className="min-w-0 flex-1">
              {/* The name and its badges are a wrapping run, not a fixed row:
                  on a phone the trigger and trust badges drop to a second line
                  instead of pushing out past the card's edge. */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h2 className="min-w-0 text-base font-semibold">{flow.name}</h2>
                {flow.builtIn && (
                  <Badge
                    variant="outline"
                    className="text-muted-foreground rounded-full"
                  >
                    Built-in
                  </Badge>
                )}
                {/* Which event starts the flow, so a proactive nudge is
                    distinguishable from an answer without opening it (#548). */}
                {!flow.isDefault && (
                  <Badge
                    variant="outline"
                    className="text-muted-foreground rounded-full"
                  >
                    {FLOW_TRIGGER_LABELS[flow.trigger ?? "message"]}
                  </Badge>
                )}
                {(() => {
                  const flowTrust = trust.find((t) => t.flowId === flow.id);
                  if (flowTrust) return <TrustBadge trust={flowTrust} />;
                  // Only generative flows are graded, so only they carry a
                  // meaningful tier, badge those with no history as watch.
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
            </SortableItem>
          ))}
        </SortableList>

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
