"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { ChannelKind, HelpDesk, SupportChannel } from "@agent-hub/core";
import { CircleHelp, Move, Plus, Trash2 } from "lucide-react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import {
  deleteHelpDeskAction,
  deleteSupportChannelAction,
  reorderSupportChannelsAction,
  updateHelpDeskAction,
} from "@/app/actions";
import type { ChannelPanelState } from "@/components/help-desks/channel-panel";
import { TicketingIntegrationSection } from "@/components/help-desks/ticketing-integration";
import { Button, Skeleton } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { Switch } from "@/components/ui/motion-switch";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_KINDS, CHANNEL_KIND_ORDER } from "@/lib/support-channels";
import {
  isRedirectError,
  useConfirmDelete,
} from "@/components/ui/confirm-delete-modal";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";
import { SectionHeading } from "@/components/ui/section-heading";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";

// Opened only after a click on a channel or "Add channel", so it never renders
// on the server anyway. Its editor, form builder, availability scheduler and
// the country and timezone lists stay out of the desk page's first bundle.
// The fallback is the sheet's own frame at its 480px default width (a literal:
// importing PANEL_MIN_WIDTH would pull the module back into this bundle), so
// the first click answers at once instead of after the chunk arrives.
const ChannelPanel = dynamic(
  () => import("@/components/help-desks/channel-panel").then((module) => module.ChannelPanel),
  {
    loading: () => (
      <aside
        className="bg-background fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-full flex-col border-l shadow-strong"
        role="status"
        aria-busy="true"
      >
        <span className="sr-only">Loading channel…</span>
        {/* Measured against the open sheet: 22px padding, the 29px back /
            title / close line, the 37px tab list, then label, hint and field
            groups 22px apart. */}
        <div className="px-6 pt-6">
          <div className="flex h-8 items-center gap-3">
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-6 w-44" />
            <Skeleton className="ml-auto size-8 rounded-md" />
          </div>
          <Skeleton className="mt-6 h-10 w-full rounded-lg" />
          <div className="mt-8 space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="mt-1 h-5 w-3/4" />
                <Skeleton className="mt-2 h-11 w-full" />
              </div>
            ))}
          </div>
        </div>
      </aside>
    ),
  },
);

function errorMessage(error: unknown, fallback: string): string {
  if (isRedirectError(error)) throw error;
  return error instanceof Error ? error.message : fallback;
}

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
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const dirty =
    canEdit && (name !== desk.name || description !== desk.description);

  // The name and description live only in local state until Save changes, so
  // a reload or a closed tab gets the browser's prompt while they differ.
  useUnsavedChanges({ dirty });

  // Local ordering, optimistically reordered by chevrons/drag, then
  // persisted; resynced whenever the server list changes underneath us
  // ("adjusting state when a prop changes", no effect needed for this part).
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
  const dragStartOrderRef = useRef<SupportChannel[]>([]);
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
      // A grab that ends where it started changed nothing worth a round trip.
      const start = dragStartOrderRef.current;
      const moved = orderRef.current.some((c, i) => c.id !== start[i]?.id);
      if (moved) persistOrder(orderRef.current);
    }
    function onCancel() {
      // The browser took the pointer (a scroll, a system gesture): put the
      // rows back rather than saving an order nobody dropped.
      dragIndexRef.current = null;
      setDraggingIndex(null);
      orderRef.current = dragStartOrderRef.current;
      setOrder(dragStartOrderRef.current);
    }
    document.body.style.cursor = "grabbing";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persistOrder is stable for this instance
  }, [draggingIndex]);

  function persistOrder(next: SupportChannel[]) {
    startTransition(async () => {
      try {
        await reorderSupportChannelsAction(
          desk.id,
          next.map((c) => c.id)
        );
      } catch (error) {
        // Put the rows back where the server still has them.
        orderRef.current = channels;
        setOrder(channels);
        toast.error(errorMessage(error, "Could not reorder the channels"));
      }
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
    dragStartOrderRef.current = order;
    setDraggingIndex(index);
  }

  // The drag handle's keyboard path: the arrows do what the drag does.
  function onDragKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    move(index, e.key === "ArrowUp" ? -1 : 1);
  }

  function openPanel(state: ChannelPanelState) {
    setPanelKey((k) => k + 1);
    setPanel(state);
  }

  function openKind(kind: ChannelKind) {
    const meta = CHANNEL_KINDS[kind];
    if (meta.requiresTicketing) {
      toast.info(
        `${meta.label} requires the ticketing integration, coming in a later iteration.`
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
    const trimmed = name.trim();
    startTransition(async () => {
      try {
        await updateHelpDeskAction(desk.id, { name: trimmed, description });
      } catch (error) {
        toast.error(errorMessage(error, "Could not save the help desk"));
        return;
      }
      // The saved name is the trimmed one; match it so the form reads clean.
      setName(trimmed);
      toast.success("Help desk updated");
    });
  }

  function handleDelete() {
    confirmDelete({
      title: <>Delete &ldquo;{desk.name}&rdquo;?</>,
      description:
        "This permanently removes the help desk and its escalation channels, and cannot be undone.",
      confirmLabel: "Delete help desk",
      onConfirm: async () => {
        await deleteHelpDeskAction(desk.id);
        toast.success("Help desk deleted");
        router.push("/help-desks");
      },
    });
  }

  function deleteChannel(channel: SupportChannel) {
    confirmDelete({
      title: <>Delete &ldquo;{channel.name}&rdquo;?</>,
      description:
        "This permanently removes the escalation channel and cannot be undone.",
      confirmLabel: "Delete channel",
      onConfirm: async () => {
        await deleteSupportChannelAction(desk.id, channel.id);
        toast.success("Escalation option deleted");
      },
    });
  }

  return (
    <div className="touch-scroll-clearance h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-10">
        <SectionHeading
          icon={CircleHelp}
          title={desk.name}
          description="Where a conversation goes when the assistant cannot answer it."
        />
        <div className="pt-6 pb-24">
          <SectionTimeline>
            <TimelineSection title="Details">
              <div className="flex items-start justify-between gap-4">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!canEdit}
                  aria-label="Help desk name"
                  autoComplete="off"
                  className="focus:ring-ring/50 -mx-2 min-w-0 flex-1 rounded-lg px-2 py-1 text-xl font-semibold outline-none focus:ring-2"
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

        <p id="help-desk-description-hint" className="text-muted-foreground mt-4 text-sm">
          Add at least {AI_RECOGNITION_TARGET} characters for best AI
          recognition (
          <RollingNumber
            value={Math.min(description.trim().length, AI_RECOGNITION_TARGET)}
          />
          /{AI_RECOGNITION_TARGET}).
        </p>
        <Textarea
          aria-describedby="help-desk-description-hint"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what this help desk handles…"
          aria-label="Help desk description"
          rows={4}
          disabled={!canEdit}
          className="mt-2"
        />
        {canEdit && dirty && (
          <div className="mt-3 flex justify-end">
            <Button className="h-10 px-5" onClick={save} disabled={isPending}>
              <RollInText text={isPending ? "Saving…" : "Save changes"} />
            </Button>
          </div>
        )}

            </TimelineSection>

            <TimelineSection title="Support Channels">
              <p className="text-muted-foreground -mt-3 mb-4 text-sm">
                Methods available for users to escalate their support requests.
                {order.length > 0 && " Complete."}
              </p>
              <section className="rounded-xl border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            <div>
              <p className="font-semibold">
                Active channels{" "}
                <span className="text-muted-foreground font-normal">
                  (<RollingNumber value={order.length} />)
                </span>
              </p>
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
                        disabled={!canEdit}
                        onClick={() => openKind(kind)}
                        className="hover:bg-muted flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60"
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
                      draggingIndex === index ? "bg-muted shadow-strong" : "bg-muted/40 hover:bg-muted/70"
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
                        <Hint label="Drag or use the arrow keys to reorder">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Drag or use the arrow keys to reorder"
                            aria-keyshortcuts="ArrowUp ArrowDown"
                            className="cursor-grab touch-none active:cursor-grabbing"
                            onPointerDown={(e) => onDragPointerDown(e, index)}
                            onKeyDown={(e) => onDragKeyDown(e, index)}
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

            </TimelineSection>

            <TimelineSection title="Answer Improvements">
              <section className="rounded-xl border bg-card px-4 py-3.5">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-sm">
                Auto-generate improvements: flag the last AI answer for review when a chat escalates here.
              </p>
            </div>
            <Switch
              checked={desk.autoGenerateImprovements}
              disabled={!canEdit || isPending}
              aria-label="Auto-generate improvements"
              onCheckedChange={(checked) =>
                startTransition(async () => {
                  try {
                    await updateHelpDeskAction(desk.id, {
                      autoGenerateImprovements: checked,
                    });
                  } catch (error) {
                    toast.error(errorMessage(error, "Could not update the setting"));
                    return;
                  }
                  toast.success(
                    checked
                      ? "Improvements will be auto-generated on escalation"
                      : "Auto-generate improvements disabled"
                  );
                })
              }
            />
          </div>
        </section>

            </TimelineSection>

            <TimelineSection title="Ticketing Integration">
              <TicketingIntegrationSection
                helpDeskId={desk.id}
                integration={desk.ticketingIntegration}
                canEdit={canEdit}
              />
            </TimelineSection>
          </SectionTimeline>
        </div>
      </div>

      {panel && (
        <ChannelPanel
          key={panelKey}
          helpDeskId={desk.id}
          initial={panel}
          canEdit={canEdit}
          onClose={() => setPanel(null)}
        />
      )}

      {confirmDeleteModal}
    </div>
  );
}
