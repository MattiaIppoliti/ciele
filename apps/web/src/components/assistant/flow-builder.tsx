"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type {
  Flow,
  FlowTrigger,
  FlowTrust,
} from "@agent-hub/core";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Info,
  LayoutList,
  ListFilter,
  MessageSquareReply,
  MousePointerClick,
  Redo2,
  Trash2,
  Undo2,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import {
  draftDiffers,
  draftSavedLabel,
  flowDraftKey,
  parseStoredDraft,
  serializeDraft,
  type RestoredDraft,
} from "@/lib/flow-draft-storage";
import { createFlowAction, deleteFlowAction, updateFlowAction } from "@/app/actions";
import { adoptFlowsAgentThreadAction } from "@/app/(admin)/assistants/[id]/flows/flows-agent-actions";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Hint,
  Input,
} from "@agent-hub/ui";
import {
  actionsFitTrigger,
  FLOW_ACTION_PICKER,
  HTTP_FLOW_ACTION_PICKER,
  FLOW_ACTIONS,
  FLOW_TRIGGER_LABELS,
  partitionActionsForTrigger,
  PROACTIVE_FLOW_ACTION_PICKER,
} from "@/lib/flow-actions";
import {
  applyTriggerChange,
  draftFromFlow,
  flowDraftStatus,
  flowSavePayload,
  triggerChangePlan,
  type FlowDraft,
} from "@/lib/flow-editor";
import {
  canRedo,
  canUndo,
  createDraftHistory,
  recordDraft,
  redoDraft,
  undoDraft,
} from "@/lib/flow-draft-history";
import { flowViewKey, insertActionAt, parseFlowView, type FlowView } from "@/lib/flow-canvas";
import { cn } from "@/lib/utils";
import { TrustBadge } from "@/components/assistant/trust-badge";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { useShell } from "@/components/shell/shell-provider";
import {
  FlowActionConfig,
  FlowConditionsConfig,
  FlowTriggerConfig,
  actionHasConfig,
  type AssistantOption,
  type FaqOption,
  type FlowStepHandlers,
  type HelpDeskOption,
} from "@/components/assistant/flow-step-config";
import type { ConnectorConnectionOption } from "@/lib/connector-options";
import { useDeferredStoredValue } from "@/components/assistant/use-deferred-stored-value";
import {
  draftPatchFromAgent,
  ensureReviewBeforeConnectorWrites,
  mergeAgentSettings,
} from "@/lib/flows-agent";

// Keep the two optional tools behind the editor's rendering seam: choosing
// the Form must not download React Flow or the agent's rich transcript.
const FlowCanvasView = dynamic(
  () => import("@/components/assistant/flow-canvas-view").then((m) => m.FlowCanvasView),
  {
    loading: () => (
      <div role="status" className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        Loading canvas…
      </div>
    ),
  }
);
const FlowsAgentPanel = dynamic(
  () => import("@/components/assistant/flows-agent-panel").then((m) => m.FlowsAgentPanel),
  {
    loading: () => (
      <div role="status" className="text-muted-foreground w-80 shrink-0 border-l p-5 text-sm">
        Loading Flows Agent…
      </div>
    ),
  }
);

/**
 * The Flow Builder: one draft, two renderings (spec #836, #837).
 *
 * The **form** is the three-step Trigger → Conditions → Response editor; the
 * **canvas** draws the same draft as a chain of nodes. Both are adapters over
 * `src/lib/flow-editor.ts` (rules), `src/lib/flow-draft-history.ts` (undo) and
 * `src/lib/flow-canvas.ts` (projection), which is where the behaviour is
 * tested, vitest ignores `.tsx` in this app. Switching renderings never
 * touches the draft, and Save sends the same payload from either.
 */

function StepCard({
  icon: Icon,
  title,
  badge,
  subtitle,
  defaultOpen = true,
  children,
}: {
  icon: LucideIcon;
  title: string;
  badge: "required" | "optional" | null;
  subtitle: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="hover:bg-muted/40 press flex w-full items-center gap-3 px-4 py-3 text-left transition-colors"
      >
        <Icon className="text-muted-foreground size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            {badge && (
              <Badge variant="outline" className="text-muted-foreground rounded-full capitalize">
                {badge}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-xs">{subtitle}</p>
        </div>
        <ChevronDown
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      {open && <CardContent className="border-t px-4 pt-4 pb-4">{children}</CardContent>}
    </Card>
  );
}

function StatusItem({
  ok,
  required,
  label,
}: {
  ok: boolean;
  required: boolean;
  label: string;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-sm",
        ok ? "text-foreground" : required ? "text-muted-foreground" : "text-muted-foreground/70"
      )}
    >
      {ok ? (
        <Check className="size-4 text-emerald-600" strokeWidth={3} />
      ) : (
        <span
          className={cn(
            "size-3.5 rounded-full border-2",
            required ? "border-muted-foreground/60" : "border-muted-foreground/30"
          )}
        />
      )}
      {label}
    </span>
  );
}

export function FlowBuilder({
  assistantId,
  flow,
  memberId,
  canEdit = true,
  assistants,
  helpDesks,
  faqs,
  connections = [],
  trust = null,
  agentProviderReady = true,
}: {
  assistantId: string;
  flow: Flow | null;
  /** The signed-in Member, for browser-stored preferences keyed per person. */
  memberId: string;
  /** False for a Viewer: both renderings open read-only, nothing saves. */
  canEdit?: boolean;
  /** Other assistants in the org, for the Handover action. */
  assistants: AssistantOption[];
  /** The Organization's Application Connections a Connector may use (#839). */
  connections?: ConnectorConnectionOption[];
  /** Help desks available to a response Button of type Help desk. */
  helpDesks: HelpDeskOption[];
  /** FAQ questions available to a response Button of type FAQ. */
  faqs: FaqOption[];
  /** Materialized trust for this flow, when it exists. */
  trust?: FlowTrust | null;
  /**
   * Whether the Flows Agent has a provider to run on (#838): an Organization
   * Provider Connection, or the opt-in that lets this Member's own subscription
   * run their Teammate turns. The page computes it; the panel disables its
   * composer when it is false.
   */
  agentProviderReady?: boolean;
}) {
  const router = useRouter();
  const isEdit = flow !== null;
  const isDefaultFlow = flow?.isDefault ?? false;

  // One history for both renderings and for the Flows Agent (#838).
  const savedDraft = useMemo(() => draftFromFlow(flow), [flow]);
  const [history, setHistory] = useState(() => createDraftHistory(savedDraft));
  const draft = history.present;

  /**
   * The draft is kept in this browser between visits (#837), so a reload or a
   * trip to another page does not lose half a Flow. Both renderings edit one
   * draft, so both get this from the one place that owns it.
   *
   * Restored after mount rather than during it, the way the view preference is:
   * the server rendered the saved Flow, and the first client paint has to agree
   * with that before anything replaces it.
   */
  const draftKey = flowDraftKey(memberId, assistantId, flow?.id ?? null);
  const [restored, setRestored] = useState<RestoredDraft | null>(null);
  const startedRef = useRef(false);
  // Two refs, not one. `startedRef` stops a restore replacing the history
  // twice (the read re-runs when `savedDraft` changes after a save, and by
  // then the history is this session's); `readyRef` is what holds the writer
  // off until the read has actually happened. With one flag the writer ran on
  // mount, found the draft identical to the saved Flow (it was, nothing had
  // been restored yet) and deleted the very draft the deferred read was about
  // to restore.
  const readyRef = useRef(false);
  useDeferredStoredValue(
    draftKey,
    (raw) => parseStoredDraft(raw, savedDraft),
    (stored) => {
      // The read has happened, whatever it found: the writer below may run.
      readyRef.current = true;
      if (startedRef.current || !stored) return;
      startedRef.current = true;
      setHistory(createDraftHistory(stored.draft));
      setRestored(stored);
    }
  );

  // Written on every edit; storage is the external system this effect exists to
  // synchronise, and it holds no React state of its own. `serializeDraft`
  // returns null once the draft matches the saved Flow again, which is how an
  // undo back to the start clears the draft rather than leaving one behind
  // claiming changes that are no longer there.
  useEffect(() => {
    if (!canEdit || !readyRef.current) return;
    const raw = serializeDraft(draft, savedDraft, new Date());
    try {
      if (raw === null) window.localStorage.removeItem(draftKey);
      else window.localStorage.setItem(draftKey, raw);
    } catch {
      /* private mode, or the quota; the draft is a convenience either way */
    }
  }, [draft, savedDraft, draftKey, canEdit]);

  /**
   * Whether there is a draft, derived rather than stored: it is exactly "the
   * draft differs from the saved Flow", which is the same question
   * `serializeDraft` answers, so the line and the storage can never disagree.
   * The restored draft keeps its own timestamp only until the first edit; after
   * that the draft is this session's, and "just now" is the honest answer.
   */
  const hasDraft = canEdit && draftDiffers(draft, savedDraft);
  const draftLabel =
    restored && draft === restored.draft
      ? draftSavedLabel(restored.savedAt, new Date())
      : "Draft saved";

  /** Saving or deleting the Flow retires its draft: it has nothing left to resume. */
  const clearStoredDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      /* private mode */
    }
  }, [draftKey]);

  /**
   * Every edit goes through here. `key` coalesces keystrokes on one field into
   * one undo step; a discrete edit (add an action, pick a trigger) passes none.
   */
  const update = useCallback(
    (
      patch: Partial<FlowDraft> | ((current: FlowDraft) => Partial<FlowDraft>),
      key?: string
    ) => {
      setHistory((current) =>
        recordDraft(
          current,
          {
            ...current.present,
            ...(typeof patch === "function" ? patch(current.present) : patch),
          },
          { key }
        )
      );
    },
    []
  );
  const undo = useCallback(() => setHistory((h) => undoDraft(h)), []);
  const redo = useCallback(() => setHistory((h) => redoDraft(h)), []);

  /**
   * The Flows Agent (#838): a validated `flows.draft` hand-back lands here as
   * one edit, through the same `update` a manual edit takes, so it is one Undo
   * step and Save sends it like anything else. Settings merge per action so a
   * patch that adds one action cannot erase a neighbour's configuration.
   */
  const applyAgentPatch = useCallback(
    (raw: Parameters<typeof draftPatchFromAgent>[0]) =>
      update((current) => {
        // A Connector write gets a Human review in front of it by default (#841).
        const patch = ensureReviewBeforeConnectorWrites(raw, current);
        const next = draftPatchFromAgent(patch);
        const settings = mergeAgentSettings(current.settings, patch);
        // The op checked the pairing rule against the trigger the model
        // named; the draft is the authority on which one it actually is.
        const trigger = next.trigger !== undefined ? next.trigger : current.trigger;
        const actions = next.actions ?? current.actions;
        if (trigger && !actionsFitTrigger(actions, trigger)) {
          const { kept, discarded } = partitionActionsForTrigger(actions, trigger);
          toast.error(
            `“${FLOW_TRIGGER_LABELS[trigger]}” cannot run ${discarded
              .map((action) => FLOW_ACTIONS[action].label)
              .join(", ")}; left out of the draft.`
          );
          next.actions = kept;
        }
        return settings ? { ...next, settings } : next;
      }),
    [update]
  );
  // The Flows Agent docks in the workspace's right rail, where the Preview
  // sits, so "open" is a rail question, not a local flag (#837). It stays
  // mounted once opened, the way the Preview does, so closing it does not throw
  // the conversation away.
  const [agentMounted, setAgentMounted] = useState(false);
  const [agentInitialMessage, setAgentInitialMessage] = useState<string | null>(null);

  // Keyed by the fields the patch touches, so typing in one field coalesces
  // while toggling a switch and then typing next to it stay two steps.
  const patchSettings = useCallback<FlowStepHandlers["patchSettings"]>(
    (key, patch) =>
      update(
        (current) => ({
          settings: { ...current.settings, [key]: { ...current.settings[key], ...patch } },
        }),
        `settings.${key}.${Object.keys(patch).sort().join(",")}`
      ),
    [update]
  );

  /** A trigger change awaiting confirmation because it discards configuration. */
  const [pendingTrigger, setPendingTrigger] = useState<FlowTrigger | null>(null);
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const { rightRail, openRightRail, closeRightRail } = useShell();
  const agentOpen = rightRail === "agent";
  const openAgent = useCallback(() => {
    setAgentMounted(true);
    openRightRail("agent");
  }, [openRightRail]);
  const askAgent = useCallback(
    (message: string) => {
      setAgentInitialMessage(message);
      openAgent();
    },
    [openAgent]
  );
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Which rendering; remembered per Member in this browser. Restored after
  // mount (deferred, like the Preview launcher does) so the server-rendered
  // form and the first client paint agree.
  const viewKey = flowViewKey(memberId);
  const [view, setView] = useState<FlowView>("form");
  useDeferredStoredValue(viewKey, parseFlowView, (stored) => {
    if (stored) setView(stored);
  });
  // The canvas's node panel: shown while a step is selected, and dropped when
  // the rendering switches, since the form has no node to show it for. It
  // floats over the canvas and holds no seat in the workspace's right rail, so
  // selecting a step evicts neither the Preview nor the Flows Agent. (It used
  // to claim the rail, back when it carried the Add palette; that palette is
  // now the canvas's own `+`.)
  const [nodePanelOpen, setNodePanelOpen] = useState(false);
  function chooseView(next: FlowView) {
    setView(next);
    setNodePanelOpen(false);
    try {
      window.localStorage.setItem(viewKey, next);
    } catch {
      /* private mode */
    }
  }

  // Undo / Redo shortcuts, in both renderings, but never while typing in a
  // field: the browser's own text undo owns those keystrokes.
  useEffect(() => {
    if (!canEdit) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.matches("input, textarea, select") || event.target.isContentEditable)
      )
        return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, canEdit]);

  const flowsHref = `/assistants/${assistantId}/flows`;

  const status = flowDraftStatus(draft, { isDefaultFlow, isEdit });
  const {
    dwellOk,
    triggerOk,
    proactive,
    inbound,
    responseOk,
    conditionsOk,
    canSave,
    disabledHint,
  } =
    status;

  /**
   * Picks a trigger, clearing configuration the new trigger cannot express.
   * Crossing the reactive/proactive line invalidates the whole Response step (and
   * any conditions), so the admin is asked first rather than losing work silently.
   */
  const chooseTrigger = useCallback(
    (next: FlowTrigger) => {
      if (triggerChangePlan(draft, next).needsConfirmation) {
        setPendingTrigger(next);
        return;
      }
      update({ trigger: next });
    },
    [draft, update]
  );

  function applyPendingTrigger() {
    if (pendingTrigger === null) return;
    const applied = applyTriggerChange(draft, pendingTrigger);
    setPendingTrigger(null);
    update(applied);
  }

  function save() {
    if (!canSave || !canEdit) return;
    const payload = flowSavePayload(draft, flow);
    startTransition(async () => {
      if (isEdit) {
        await updateFlowAction(assistantId, flow.id, {
          ...(flow.builtIn ? {} : { name: draft.name.trim() }),
          ...payload,
        });
        toast.success("Flow updated");
      } else {
        const created = await createFlowAction(assistantId, { name: draft.name.trim(), ...payload });
        // The Flows Agent thread held on the new-Flow canvas follows the Flow
        // it became; a failure here loses nothing the Editor can see now.
        await adoptFlowsAgentThreadAction(assistantId, created.id).catch(() => undefined);
        toast.success("Flow created");
      }
      clearStoredDraft();
      router.push(flowsHref);
    });
  }

  function handleDelete() {
    if (!flow || !canEdit) return;
    const target = flow;
    confirmDelete({
      title: <>Delete &ldquo;{target.name}&rdquo;?</>,
      description:
        "This permanently removes the flow from this assistant and cannot be undone.",
      confirmLabel: "Delete flow",
      onConfirm: async () => {
        await deleteFlowAction(assistantId, target.id);
        toast.success("Flow deleted");
        clearStoredDraft();
        router.push(flowsHref);
      },
    });
  }

  const stepHandlers = useMemo<FlowStepHandlers>(
    () => ({
      chooseTrigger,
      removeTrigger: () => update({ trigger: null }),
      setDwell: (dwell) => update({ dwell }, "dwell"),
      setHttpMethods: (httpMethods) => update({ httpMethods }, "httpMethods"),
      setConditionLogic: (conditionLogic) => update({ conditionLogic }),
      // Same count = a field inside a condition is being typed, so coalesce;
      // a different count is a condition added or removed, its own step.
      setConditions: (conditions) =>
        update(
          { conditions },
          conditions.length === draft.conditions.length ? "conditions" : undefined
        ),
      addAction: (action, index) =>
        update((current) => ({
          actions: insertActionAt(
            current.actions,
            action,
            index === undefined ? current.actions.length : index
          ),
        })),
      removeAction: (action) =>
        update((current) => ({ actions: current.actions.filter((a) => a !== action) })),
      setActions: (actions) => update({ actions }),
      patchSettings,
      setCustomMessage: (customMessage) => update({ customMessage }, "customMessage"),
    }),
    [chooseTrigger, update, patchSettings, draft.conditions.length]
  );

  const canDelete = isEdit && canEdit && !flow.builtIn;

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href={flowsHref}
        className="text-muted-foreground press-text flex items-center gap-1 text-sm font-medium hover:opacity-70"
      >
        <ChevronLeft className="size-4" strokeWidth={3} />
        All flows
      </Link>
      <span className="text-muted-foreground">/</span>
      <Input
        ref={nameInputRef}
        value={draft.name}
        onChange={(e) => update({ name: e.target.value }, "name")}
        placeholder="Name this flow..."
        disabled={!canEdit || (isEdit && flow.builtIn)}
        className="h-9 min-w-0 flex-1 font-semibold"
      />
      {isEdit &&
        (trust ? (
          <div className="shrink-0">
            <TrustBadge trust={trust} />
          </div>
        ) : (
          (flow.isDefault || draft.actions.includes("search_knowledge")) && (
            <div className="shrink-0">
              <TrustBadge trust={null} />
            </div>
          )
        ))}
      {canEdit && (
        <div className="flex items-center gap-1">
          <Hint label="Undo (⌘Z)">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Undo"
              disabled={!canUndo(history)}
              onClick={undo}
            >
              <Undo2 className="size-4" />
            </Button>
          </Hint>
          <Hint label="Redo (⇧⌘Z)">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Redo"
              disabled={!canRedo(history)}
              onClick={redo}
            >
              <Redo2 className="size-4" />
            </Button>
          </Hint>
        </div>
      )}
      {/* Form ↔ Canvas: two renderings of one draft. */}
      <div
        role="tablist"
        aria-label="Editor view"
        className="border-input flex items-center rounded-lg border p-0.5"
      >
        {(
          [
            { value: "form", label: "Form", icon: LayoutList },
            { value: "canvas", label: "Canvas", icon: Workflow },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={view === option.value}
            onClick={() => chooseView(option.value)}
            className={cn(
              "press-control flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              view === option.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <option.icon className="size-3.5" />
            {option.label}
          </button>
        ))}
      </div>
      {view === "canvas" && canEdit && (
        <Hint label={agentOpen ? "Hide Flows Agent" : "Flows Agent"}>
          <Button
            type="button"
            variant={agentOpen ? "default" : "outline"}
            size="sm"
            aria-pressed={agentOpen}
            onClick={() => (agentOpen ? closeRightRail("agent") : openAgent())}
          >
            <Zap className="size-4" /> Agent
          </Button>
        </Hint>
      )}
      {/* Quiet reassurance, not a control: it says the draft in this browser is
          current, which is the question an Editor who just reloaded has. */}
      {hasDraft && (
        <Hint label="Your unsaved changes are kept in this browser until you save or discard them.">
          <span className="text-muted-foreground hidden text-xs sm:inline">{draftLabel}</span>
        </Hint>
      )}
      {isEdit && (
        <div className="flex items-center gap-2">
          {/* Delete used to live in the canvas's own menu; with that menu gone
              it is one control in both renderings. */}
          {canDelete && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive font-semibold"
              onClick={handleDelete}
            >
              Delete
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="rounded-xl px-5 font-semibold"
            onClick={() => router.push(flowsHref)}
          >
            {canEdit ? "Cancel" : "Close"}
          </Button>
        </div>
      )}
    </div>
  );

  const footer = (
    <div className="sticky bottom-2 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card/95 px-3 py-2 shadow-md backdrop-blur">
      <StatusItem ok={triggerOk} required label="Trigger set" />
      <StatusItem
        ok={proactive || inbound || (draft.conditions.length > 0 && conditionsOk)}
        required={false}
        label={
          proactive || inbound
            ? "No conditions for this trigger"
            : draft.conditions.length === 0
              ? "No conditions added"
              : conditionsOk
                ? "Conditions added"
                : "Conditions need setup"
        }
      />
      <StatusItem ok={responseOk} required label="Response added" />
      <div className="ml-auto flex items-center gap-4">
        {canEdit && disabledHint && (
          <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Info className="size-4" /> {disabledHint}
          </span>
        )}
        {canEdit ? (
          <Button
            type="button"
            disabled={!canSave || isPending}
            onClick={save}
            className="h-9 rounded-lg px-4 font-semibold"
          >
            {isPending ? "Saving..." : isEdit ? "Save changes" : "Create flow"}
          </Button>
        ) : (
          <span className="text-muted-foreground text-sm">Read-only</span>
        )}
      </div>
    </div>
  );

  const triggerDialog = (
    <Dialog
      open={pendingTrigger !== null}
      onOpenChange={(open) => {
        if (!open) setPendingTrigger(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change the trigger?</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          {pendingTrigger === null
            ? null
            : (() => {
                const plan = triggerChangePlan(draft, pendingTrigger);
                return `“${FLOW_TRIGGER_LABELS[pendingTrigger]}” cannot run ${plan.discarded
                  .map((action) => FLOW_ACTIONS[action].label)
                  .join(", ")}${
                  plan.clearsConditions
                    ? ", and a flow that starts on its own has no conditions"
                    : ""
                }. Changing the trigger removes ${
                  plan.clearsConditions ? "them" : "those actions"
                }; everything else is kept.`;
              })()}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setPendingTrigger(null)}>
            Keep current trigger
          </Button>
          <Button type="button" onClick={applyPendingTrigger}>
            Change and clear
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  if (view === "canvas") {
    return (
      <div
        className={cn(
          "flex h-full min-h-0 flex-col",
          isPending && "pointer-events-none opacity-70"
        )}
      >
        <div className="border-b px-4 py-3 sm:px-5">{header}</div>
        {/* Canvas left, the rail right (#837). The Flows Agent docks where the
            Preview does and wears its chrome, so the two swap rather than
            stack; the canvas's own node panel is the rail's third tenant. */}
        <div className="relative flex min-h-0 flex-1">
          <FlowCanvasView
            assistantId={assistantId}
            flowId={flow?.id ?? null}
            memberId={memberId}
            readOnly={!canEdit}
            draft={draft}
            status={status}
            isDefaultFlow={isDefaultFlow}
            helpDesks={helpDesks}
            faqs={faqs}
            assistants={assistants}
            connections={connections}
            handlers={stepHandlers}
            panelOpen={nodePanelOpen}
            onOpenPanel={() => setNodePanelOpen(true)}
            onClosePanel={() => setNodePanelOpen(false)}
            onOpenPreview={() => openRightRail("preview")}
            onAskAgent={canEdit ? askAgent : undefined}
            agentOpen={agentOpen}
          />
          {canEdit && agentMounted && (
            <FlowsAgentPanel
              assistantId={assistantId}
              flowId={flow?.id ?? null}
              draft={draft}
              onDraftPatch={applyAgentPatch}
              collapsed={!agentOpen}
              onCollapsedChange={(collapsed) =>
                collapsed ? closeRightRail("agent") : openAgent()
              }
              initialMessage={agentInitialMessage}
              providerReady={agentProviderReady}
            />
          )}
        </div>
        <div className="px-4 pb-2 sm:px-5">{footer}</div>
        {triggerDialog}
        {confirmDeleteModal}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mx-auto max-w-2xl px-4 py-5 sm:px-5",
        isPending && "pointer-events-none opacity-70"
      )}
    >
      {header}

      {/* A disabled fieldset is how a Viewer reads the same form without a
          second, read-only rendering of every field. */}
      <fieldset disabled={!canEdit} className="mt-4 min-w-0 space-y-4 pb-3">
        <StepCard
          icon={MousePointerClick}
          title="Trigger"
          badge={isDefaultFlow ? null : "required"}
          subtitle="Define the event that starts this flow"
          defaultOpen={!triggerOk}
        >
          <FlowTriggerConfig
            isDefaultFlow={isDefaultFlow}
            trigger={draft.trigger}
            dwell={draft.dwell}
            dwellOk={dwellOk}
            proactive={proactive}
            onChoose={chooseTrigger}
            onRemove={stepHandlers.removeTrigger}
            onDwellChange={stepHandlers.setDwell}
            httpMethods={draft.httpMethods}
            flowId={flow?.id ?? null}
            onHttpMethodsChange={stepHandlers.setHttpMethods}
          />
        </StepCard>

        <StepCard
          icon={ListFilter}
          title="Conditions"
          badge={isDefaultFlow ? null : "optional"}
          subtitle="Criteria that must be met for the flow to continue."
          defaultOpen={draft.conditions.length > 0}
        >
          <FlowConditionsConfig
            isDefaultFlow={isDefaultFlow}
            trigger={draft.trigger}
            proactive={proactive || inbound}
            conditionLogic={draft.conditionLogic}
            conditions={draft.conditions}
            onLogicChange={stepHandlers.setConditionLogic}
            onConditionsChange={stepHandlers.setConditions}
          />
        </StepCard>

        <StepCard
          icon={MessageSquareReply}
          title="Response"
          badge={isDefaultFlow ? null : "required"}
          subtitle="Define what will happen if the trigger and conditions are met."
          defaultOpen={!responseOk}
        >
          <div className="space-y-3">
            {draft.actions.map((action) => {
              const meta = FLOW_ACTIONS[action];
              const Icon = meta.icon;
              return (
                <div key={action} className="space-y-3 rounded-lg border bg-background p-3">
                  <div className="flex items-start gap-3">
                    <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{meta.label}</h3>
                        {meta.beta && (
                          <Badge
                            variant="outline"
                            className="text-muted-foreground rounded-full"
                          >
                            beta
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground text-sm">{meta.subtitle}</p>
                    </div>
                    {canEdit && (
                      <Hint label={`Remove ${meta.label}`}>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`Remove ${meta.label}`}
                          onClick={() => stepHandlers.removeAction(action)}
                        >
                          <AnimatedIcon icon={Trash2} size={16} />
                        </Button>
                      </Hint>
                    )}
                  </div>
                  {actionHasConfig(action) && (
                    <FlowActionConfig
                      action={action}
                      assistantId={assistantId}
                      settings={draft.settings}
                      customMessage={draft.customMessage}
                      helpDesks={helpDesks}
                      faqs={faqs}
                      assistants={assistants}
                      connections={connections}
                      onPatchSettings={patchSettings}
                      onCustomMessageChange={stepHandlers.setCustomMessage}
                    />
                  )}
                </div>
              );
            })}

            {canEdit && (
              <div>
                <p className="text-sm font-semibold">Add an action</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(proactive
                    ? PROACTIVE_FLOW_ACTION_PICKER
                    : inbound
                      ? HTTP_FLOW_ACTION_PICKER
                      : FLOW_ACTION_PICKER
                  ).map(
                    (key) => {
                      const meta = FLOW_ACTIONS[key];
                      const Icon = meta.icon;
                      const added = draft.actions.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={added}
                          onClick={() => stepHandlers.addAction(key)}
                          className="hover:bg-muted/50 press flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-40"
                        >
                          <Icon className="text-foreground/70 mt-0.5 size-5 shrink-0" />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2 text-sm font-semibold">
                              {meta.label}
                              {meta.beta && (
                                <Badge
                                  variant="outline"
                                  className="text-muted-foreground rounded-full"
                                >
                                  beta
                                </Badge>
                              )}
                            </span>
                            <span className="text-muted-foreground block text-sm">
                              {meta.subtitle}
                            </span>
                          </span>
                        </button>
                      );
                    }
                  )}
                </div>
              </div>
            )}
          </div>
        </StepCard>
      </fieldset>

      {triggerDialog}
      {footer}
      {confirmDeleteModal}
    </div>
  );
}
