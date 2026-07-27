"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Link } from "@/components/ui/link";
import { useRouter } from "next/navigation";
import type { ChannelKind, HelpDesk, SupportChannel } from "@agent-hub/core";
import {
  CircleCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Move,
  Plus,
  Trash2,
} from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import {
  deleteHelpDeskAction,
  deleteSupportChannelAction,
  reorderSupportChannelsAction,
  updateHelpDeskAction,
} from "@/app/actions";
import {
  ChannelPanel,
  type ChannelPanelState,
} from "@/components/help-desks/channel-panel";
import { TicketingIntegrationSection } from "@/components/help-desks/ticketing-integration";
import { Button } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_KINDS, CHANNEL_KIND_ORDER } from "@/lib/support-channels";

const AI_RECOGNITION_TARGET = 200;

export function HelpDeskManage({
  desk,
  channels,
  canEdit,
}: {
  desk: HelpDesk;
  channels: SupportChannel[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(desk.name);
  const [description, setDescription] = useState(desk.description);
  const [panel, setPanel] = useState<ChannelPanelState | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  const dirty = name !== desk.name || description !== desk.description;

  // Local ordering, optimistically reordered by chevrons/drag, then
  // persisted; resynced whenever the server list changes underneath us
  // ("adjusting state when a prop changes" — no effect needed for this part).
  const [order, setOrder] = useState<SupportChannel[]>(channels);
  const [syncedChannels, setSyncedChannels] = useState(channels);
  if (channels !== syncedChannels) {
    setSyncedChannels(channels);
    setOrder(channels);
  }

  const orderRef = useRef(order);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Mirrors the resize-drag effect in app-sidebar.tsx: side effects (cursor,
  // window listeners) live in an effect gated by a boolean, not in the
  // handlers that flip it.
  useEffect(() => {
    if (draggingIndex === null) return;
    function onMove(e: PointerEvent) {
      const from = dragIndexRef.current;
      if (from === null) return;
      const y = e.clientY;
      const current = orderRef.current;
      for (let i = 0; i < current.length; i++) {
        if (i === from) continue;
        const row = rowRefs.current.get(current[i].id);
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom) {
          const next = [...current];
          const [moved] = next.splice(from, 1);
          next.splice(i, 0, moved);
          orderRef.current = next;
          setOrder(next);
          dragIndexRef.current = i;
          setDraggingIndex(i);
          break;
        }
      }
    }
    function onUp() {
      dragIndexRef.current = null;
      setDraggingIndex(null);
      persistOrder(orderRef.current);
    }
    document.body.style.cursor = "grabbing";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persistOrder is stable for this instance
  }, [draggingIndex]);

  function persistOrder(next: SupportChannel[]) {
    startTransition(async () => {
      await reorderSupportChannelsAction(
        desk.id,
        next.map((c) => c.id)
      );
      router.refresh();
    });
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    orderRef.current = next;
    setOrder(next);
    persistOrder(next);
  }

  function onDragPointerDown(e: React.PointerEvent, index: number) {
    if (!canEdit || order.length < 2) return;
    e.preventDefault();
    dragIndexRef.current = index;
    setDraggingIndex(index);
  }

  function openPanel(state: ChannelPanelState) {
    setPanelKey((k) => k + 1);
    setPanel(state);
  }

  function openKind(kind: ChannelKind) {
    const meta = CHANNEL_KINDS[kind];
    if (meta.requiresTicketing) {
      toast.info(
        `${meta.label} requires the ticketing integration — coming in a later iteration.`
      );
      return;
    }
    openPanel({ mode: "new", kind });
  }

  function save() {
    if (!name.trim()) {
      toast.error("Help desk name is required");
      return;
    }
    startTransition(async () => {
      await updateHelpDeskAction(desk.id, { name: name.trim(), description });
      toast.success("Help desk updated");
      router.refresh();
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete help desk "${desk.name}"?`)) return;
    startTransition(async () => {
      await deleteHelpDeskAction(desk.id);
      toast.success("Help desk deleted");
      router.push("/help-desks");
    });
  }

  function deleteChannel(channel: SupportChannel) {
    if (!window.confirm(`Delete escalation channel "${channel.name}"?`)) return;
    startTransition(async () => {
      await deleteSupportChannelAction(desk.id, channel.id);
      toast.success("Escalation option deleted");
      router.refresh();
    });
  }

  return (
    <div
      className={`flex h-full flex-col overflow-y-auto ${
        isPending ? "pointer-events-none opacity-70" : ""
      }`}
    >
      <header className="flex shrink-0 items-center gap-3 px-6 pt-5 pb-4">
        <Link
          href="/help-desks"
          className="text-muted-foreground flex items-center gap-1 text-sm font-medium hover:opacity-70"
        >
          <ChevronLeft className="size-4" strokeWidth={3} />
          All help desks
        </Link>
      </header>

      <div className="mx-auto w-full max-w-4xl flex-1 border-t px-8 py-8">
        <div className="flex items-start justify-between gap-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            aria-label="Help desk name"
            className="focus:ring-ring/50 -mx-2 min-w-0 flex-1 rounded-lg px-2 py-1 text-3xl font-bold tracking-tight outline-none focus:ring-2"
          />
          {canEdit && (
            <Hint label="Delete help desk">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete help desk"
                className="text-destructive hover:text-destructive"
                onClick={handleDelete}
              >
                <AnimatedIcon icon={Trash2} size={20} />
              </Button>
            </Hint>
          )}
        </div>

        <p className="text-muted-foreground mt-4 text-sm">
          Add at least {AI_RECOGNITION_TARGET} characters for best AI
          recognition (
          {Math.min(description.trim().length, AI_RECOGNITION_TARGET)}/
          {AI_RECOGNITION_TARGET}).
        </p>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what this help desk handles..."
          rows={4}
          disabled={!canEdit}
          className="mt-2"
        />
        {canEdit && dirty && (
          <div className="mt-3 flex justify-end">
            <Button className="h-10 px-5" onClick={save} disabled={isPending}>
              {isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        )}

        <div className="my-8 border-t" />

        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold tracking-tight">Support Channels</h2>
          {order.length > 0 && (
            <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-sm font-medium">
              <CircleCheck className="size-4" /> Complete
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Methods available for users to escalate their support requests.
        </p>

        <section className="mt-5 rounded-xl border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            <div>
              <p className="font-semibold">Active channels</p>
              <p className="text-muted-foreground text-sm">
                Support methods available to users during chat.
              </p>
            </div>
            {canEdit && (
              <Button
                className="ml-auto h-9 rounded-lg px-3.5 font-medium"
                onClick={() => openPanel({ mode: "select" })}
              >
                <Plus className="size-4" /> Add channel
              </Button>
            )}
          </div>

          <div className="space-y-2 p-4">
            {order.length === 0 ? (
              <>
                <p className="text-muted-foreground text-sm">
                  Add a channel to give users a way to escalate conversations.
                </p>
                <div className="flex flex-wrap gap-3">
                  {CHANNEL_KIND_ORDER.map((kind) => {
                    const meta = CHANNEL_KINDS[kind];
                    const Icon = meta.icon;
                    return (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => canEdit && openKind(kind)}
                        className="hover:bg-muted flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors"
                      >
                        <span className="bg-muted flex size-8 items-center justify-center rounded-md">
                          <Icon className="size-4" />
                        </span>
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              order.map((channel, index) => {
                const meta = CHANNEL_KINDS[channel.kind];
                const Icon = meta.icon;
                return (
                  <div
                    key={channel.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(channel.id, el);
                      else rowRefs.current.delete(channel.id);
                    }}
                    className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
                      draggingIndex === index ? "bg-muted shadow-sm" : "bg-muted/40 hover:bg-muted/70"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {channel.name}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        {meta.label}
                      </p>
                    </div>
                    <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs font-medium">
                      <Icon className="size-4" /> {meta.label}
                    </span>
                    {canEdit && (
                      <>
                        <Hint label="Move up">
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Move up"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                            className="bg-background"
                          >
                            <ChevronUp className="size-4" />
                          </Button>
                        </Hint>
                        <Hint label="Move down">
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Move down"
                            disabled={index === order.length - 1}
                            onClick={() => move(index, 1)}
                            className="bg-background"
                          >
                            <ChevronDown className="size-4" />
                          </Button>
                        </Hint>
                        <Hint label={`Delete ${channel.name}`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${channel.name}`}
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteChannel(channel)}
                          >
                            <AnimatedIcon icon={Trash2} size={16} />
                          </Button>
                        </Hint>
                        <Hint label="Reorder escalation option">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Drag to reorder"
                            className="cursor-grab touch-none active:cursor-grabbing"
                            onPointerDown={(e) => onDragPointerDown(e, index)}
                          >
                            <Move className="size-4" />
                          </Button>
                        </Hint>
                      </>
                    )}
                    <Hint label={`Edit ${channel.name}`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${channel.name}`}
                        onClick={() => openPanel({ mode: "edit", channel })}
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </Hint>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="mt-4 rounded-xl border bg-card px-4 py-3.5">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 className="font-semibold">Answer Improvements</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Auto-generate improvements: when a conversation escalates
                through this desk, flag the last AI answer as an Improvement
                item for review.
              </p>
            </div>
            <Switch
              checked={desk.autoGenerateImprovements}
              disabled={!canEdit || isPending}
              aria-label="Auto-generate improvements"
              onCheckedChange={(checked) =>
                startTransition(async () => {
                  await updateHelpDeskAction(desk.id, {
                    autoGenerateImprovements: checked,
                  });
                  toast.success(
                    checked
                      ? "Improvements will be auto-generated on escalation"
                      : "Auto-generate improvements disabled"
                  );
                  router.refresh();
                })
              }
            />
          </div>
        </section>

        <TicketingIntegrationSection
          helpDeskId={desk.id}
          integration={desk.ticketingIntegration}
          canEdit={canEdit}
        />
      </div>

      {panel && (
        <ChannelPanel
          key={panelKey}
          helpDeskId={desk.id}
          initial={panel}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}
