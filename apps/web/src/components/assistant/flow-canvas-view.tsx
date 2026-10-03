"use client";

import { RollInText } from "@/components/motion/roll-in-text";

import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useTheme } from "@/components/theme-provider";
import type { FlowAction } from "@agent-hub/core";
import {
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/motion/context-menu";
import "@xyflow/react/dist/style.css";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ExternalLink, LayoutGrid, MousePointerClick, Plus, RotateCcw, Search, SlidersHorizontal, Trash2, Unplug, Workflow, X, type LucideIcon } from "lucide-react";
import { Brush, Ellipsis, ListFilter, Maximize, Maximize2, Minimize2 } from "lucide-react";
import { Badge, Button, Hint, Input } from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { useFullscreenGrow } from "@/components/chat/use-fullscreen-grow";
import { useDeferredStoredValue } from "@/components/assistant/use-deferred-stored-value";
import { FLOW_ACTIONS } from "@/lib/flow-actions";
import { PromptInput } from "@/components/agents/prompt-input";
import { CanvasToolbar } from "@/components/assistant/canvas-toolbar";
import { CommandBar } from "@/components/assistant/command-bar";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { isTypingTarget } from "@/lib/typing-target";
import { newFlowCondition } from "@/lib/flow-conditions";
import type { FlowDraft, FlowDraftStatus } from "@/lib/flow-editor";
import {
  CANVAS_NODE_WIDTH,
  CONDITIONS_NODE_ID,
  TRIGGER_NODE_ID,
  actionFromNodeId,
  actionNodeId,
  canvasDirectionKey,
  canvasOffsetsKey,
  dropIndexAt,
  filterFlowStepEntries,
  flowStepEntries,
  flowStepGroupsOf,
  layoutFlowCanvas,
  moveAction,
  offsetFor,
  paletteForDraft,
  parseCanvasDirection,
  parseCanvasOffsets,
  projectFlowCanvas,
  reorderFromDrop,
  type CanvasDirection,
  type CanvasOffsets,
  type FlowCanvasNode,
  type FlowStepChoice,
  type FlowStepEntry,
  type FlowStepGroup,
} from "@/lib/flow-canvas";
import { cn } from "@/lib/utils";
import {
  FlowActionConfig,
  FlowConditionsConfig,
  FlowTriggerConfig,
  TestRequestControl,
  actionHasConfig,
  type AssistantOption,
  type FaqOption,
  type FlowStepHandlers,
  type HelpDeskOption,
} from "@/components/assistant/flow-step-config";
import type { ConnectorConnectionOption } from "@/lib/connector-options";
import { TestConnectorControl } from "@/components/assistant/flow-connector-config";
import { HumanReviewPreview } from "@/components/assistant/flow-human-review-config";
import { FlowCanvasField } from "@/components/assistant/flow-canvas-field";
import { canAutoFocus } from "@/lib/auto-focus";

/**
 * The Flow Canvas rendering (spec #836, #837): React Flow in fully controlled
 * mode over `projectFlowCanvas`. Nothing here decides what a node *is*; the
 * component draws the projection, forwards edits to the builder's handlers, and
 * keeps the one piece of state that is its own, the Member's manual offsets,
 * in the browser.
 */

// React Flow constrains node data to `Record<string, unknown>`; the intersection
// keeps the projected node's fields typed while satisfying that bound.
type CanvasNodeData = FlowCanvasNode & {
  selected: boolean;
  /**
   * Where a step added from this node's `+` lands in the action order: after
   * this one. The trigger and the Conditions step both precede every action,
   * so both insert at 0.
   */
  insertIndex: number;
  /** Which way the chain runs, which is which edges the handles sit on. */
  direction: CanvasDirection;
} & Record<string, unknown>;
type CanvasNode = Node<CanvasNodeData, "flowNode">;

/** The MIME type a palette drag carries, so the canvas ignores foreign drops. */
const PALETTE_ACTION_MIME = "application/x-ciele-flow-action";

const NODE_ICONS: Record<FlowCanvasNode["kind"], typeof MousePointerClick> = {
  trigger: MousePointerClick,
  conditions: ListFilter,
  action: LayoutGrid,
};

/**
 * The "Add a step" control every node shows on hover. Built by the canvas,
 * which is where the catalogue and the handlers are, and handed to the node
 * cards through context because React Flow owns their render. A factory rather
 * than one element: each node inserts at its own place in the chain.
 */
const AddStepContext = createContext<((insertIndex: number) => ReactNode) | null>(null);

function CanvasNodeCard({ data }: NodeProps<CanvasNode>) {
  const Icon =
    data.kind === "action" && data.action ? FLOW_ACTIONS[data.action].icon : NODE_ICONS[data.kind];
  const renderAddStep = useContext(AddStepContext);
  return (
    <div
      data-selected={data.selected || undefined}
      className="flow-surface-card press group relative flex items-start gap-3 px-3.5 py-3"
      style={{ width: CANVAS_NODE_WIDTH }}
    >
      {renderAddStep?.(data.insertIndex)}
      {data.kind !== "trigger" && (
        <Handle
          type="target"
          position={data.direction === "vertical" ? Position.Top : Position.Left}
          className="flow-surface-handle"
        />
      )}
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
          data.kind === "trigger"
            ? "bg-emerald-500/15 text-emerald-600"
            : data.kind === "conditions"
              ? "bg-amber-500/15 text-amber-600"
              : "bg-primary/10 text-primary"
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold"><RollInText text={data.title} /></span>
          {data.kind === "action" && data.action && FLOW_ACTIONS[data.action].beta && (
            <Badge variant="outline" className="text-muted-foreground rounded-full">
              beta
            </Badge>
          )}
        </span>
        <span className="text-muted-foreground block truncate text-xs">{data.subtitle}</span>
        {data.status === "needs_setup" && (
          <StatusPill status="error" className="mt-1.5 text-2xs" primaryText="Needs setup" />
        )}
        {data.status === "preview_only" && (
          <StatusPill status="warning" className="mt-1.5 text-2xs" primaryText="Preview only" />
        )}
      </span>
      <Handle
        type="source"
        position={data.direction === "vertical" ? Position.Bottom : Position.Right}
        className="flow-surface-handle"
      />
    </div>
  );
}

const NODE_TYPES = { flowNode: CanvasNodeCard };

export function FlowCanvasView(props: FlowCanvasViewProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

interface FlowCanvasViewProps {
  assistantId: string;
  flowId: string | null;
  memberId: string;
  /** A Viewer: nodes select but do not drag, no palette, fields disabled. */
  readOnly: boolean;
  draft: FlowDraft;
  status: FlowDraftStatus;
  isDefaultFlow: boolean;
  helpDesks: HelpDeskOption[];
  faqs: FaqOption[];
  assistants: AssistantOption[];
  /** The Organization's Application Connections a Connector may use (#839). */
  connections: ConnectorConnectionOption[];
  handlers: FlowStepHandlers;
  /**
   * Whether the node panel is showing. The builder owns the flag so it can
   * drop it when the rendering switches; the panel itself floats over the
   * canvas and holds no seat in the workspace's right rail, so opening it
   * evicts neither the Preview nor the Flows Agent.
   */
  panelOpen: boolean;
  onOpenPanel: () => void;
  /** Hides the panel when nothing is selected any more. */
  onClosePanel: () => void;
  onOpenPreview: () => void;
  /**
   * Hands a prompt to the Flows Agent (#838). Present only when the panel can
   * open (an Editor's canvas); the empty canvas then offers a prompt box in
   * place of the "pick a trigger" hint.
   */
  onAskAgent?: (message: string) => void;
  /** Whether the agent panel is already open, in which case the box is redundant. */
  agentOpen: boolean;
}

type CanvasTool = "select" | "hand";

/**
 * One entry of the selected step's overflow menu.
 *
 * Built once by the canvas and rendered in three places, the panel's own `⋯`,
 * the same `⋯` in the bottom-left pill, and the right-click menu, because the
 * three are the same offer reached from wherever the pointer already is. A list
 * of data rather than three copies of the markup: the menu components differ
 * (a dropdown popup and a context menu are not the same primitive), the offer
 * does not.
 */
interface NodeMenuEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  run: () => void;
}

function FlowCanvasInner({
  assistantId,
  flowId,
  memberId,
  readOnly,
  draft,
  status,
  isDefaultFlow,
  helpDesks,
  faqs,
  assistants,
  connections,
  handlers,
  panelOpen,
  onOpenPanel,
  onClosePanel,
  onOpenPreview,
  onAskAgent,
  agentOpen,
}: FlowCanvasViewProps) {
  const projection = useMemo(
    () => projectFlowCanvas(draft, { isDefaultFlow }),
    [draft, isDefaultFlow]
  );
  const palette = useMemo(
    () => paletteForDraft(draft, { isDefaultFlow }),
    [draft, isDefaultFlow]
  );
  const { screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow();

  /**
   * Which way the chain runs. A viewing preference, so it is kept per Member
   * per Assistant rather than per Flow, and read after mount for the same
   * reason the offsets are: the server rendered the horizontal chain and the
   * first client paint has to agree with it.
   */
  const [direction, setDirection] = useState<CanvasDirection>("horizontal");
  const directionKey = canvasDirectionKey(memberId, assistantId);
  useDeferredStoredValue(directionKey, parseCanvasDirection, (stored) => {
    if (stored) setDirection(stored);
  });
  const changeDirection = useCallback(
    (next: CanvasDirection) => {
      setDirection(next);
      try {
        window.localStorage.setItem(directionKey, next);
      } catch {
        /* private mode */
      }
    },
    [directionKey]
  );

  // Manual offsets: browser-only, per Member, per saved Flow (#827), and per
  // direction, since an offset is a nudge away from a derived position and the
  // derivation is exactly what the direction changes. An unsaved Flow keeps
  // them in memory only.
  const offsetsKey = canvasOffsetsKey(memberId, assistantId, flowId, direction);
  const [offsets, setOffsets] = useState<CanvasOffsets>({});
  useDeferredStoredValue(offsetsKey, parseCanvasOffsets, (stored) => {
    // A new, unsaved Flow has no key and keeps its offsets in memory only.
    if (offsetsKey) setOffsets(stored);
  });
  // A direction flip changes the key, and the read above is deferred: until it
  // lands the old direction's offsets would be applied to the new derivation.
  const [offsetsFor, setOffsetsFor] = useState(offsetsKey);
  if (offsetsFor !== offsetsKey) {
    setOffsetsFor(offsetsKey);
    setOffsets({});
  }
  const persistOffsets = useCallback(
    (next: CanvasOffsets) => {
      setOffsets(next);
      if (!offsetsKey) return;
      try {
        if (Object.keys(next).length === 0) window.localStorage.removeItem(offsetsKey);
        else window.localStorage.setItem(offsetsKey, JSON.stringify(next));
      } catch {
        /* private mode */
      }
    },
    [offsetsKey]
  );
  /** Drop one node's nudge, putting it back on its derived position. */
  const resetOffset = useCallback(
    (id: string) => {
      const next = { ...offsets };
      delete next[id];
      persistOffsets(next);
    },
    [offsets, persistOffsets]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<CanvasTool>("select");
  // Which node the last right-click landed on, so one menu can be about the
  // canvas or about a step without two triggers over the same pixels.
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  // The step picker's open state lives here because two things open it: the
  // bottom bar's `+` and the context menu's "Add a step".
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedNode = projection.nodes.find((node) => node.id === selectedId) ?? null;

  // A brand-new Flow is a blank sheet: only the prompt box (or the hint) is
  // drawn until the Member adds something or asks to build by hand. Drawing the
  // "Start" and "Conditions" placeholders under the prompt read as a half-built
  // flow the Member had not made.
  const blank = !isDefaultFlow && draft.trigger === null && draft.actions.length === 0;
  const [buildByHand, setBuildByHand] = useState(false);
  const showChain = !blank || buildByHand;

  const positions = useMemo(
    () => layoutFlowCanvas(projection.nodes, offsets, direction),
    [projection.nodes, offsets, direction]
  );

  // React Flow keeps the nodes it is dragging; we only rebuild the list when the
  // projection or the committed positions change. Overriding positions from
  // our own state on every drag frame (the previous approach) re-rendered the
  // whole graph per pointer move and snapped the node back to its derived
  // position for one frame between the drag ending and the offset persisting.
  const builtNodes: CanvasNode[] = useMemo(
    () =>
      showChain
        ? projection.nodes.map((node) => ({
            id: node.id,
            type: "flowNode",
            position: positions[node.id]!,
            data: {
              ...node,
              selected: node.id === selectedId,
              // After this node: an action's own index plus one, and 0 for the
              // two step nodes, which precede every action.
              insertIndex: node.action ? draft.actions.indexOf(node.action) + 1 : 0,
              direction,
            },
            draggable: !readOnly,
            selectable: true,
          }))
        : [],
    [projection.nodes, positions, selectedId, readOnly, showChain, draft.actions, direction]
  );
  // Re-seed the live list whenever the built one changes, during render rather
  // than in an effect, so the graph never paints a stale frame in between.
  const [nodes, setNodes] = useState<CanvasNode[]>(builtNodes);
  const [seededFrom, setSeededFrom] = useState(builtNodes);
  if (seededFrom !== builtNodes) {
    setSeededFrom(builtNodes);
    setNodes(builtNodes);
  }
  const edges: Edge[] = useMemo(
    () =>
      showChain
        ? projection.edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            // Bezier, the reference's curve between two steps.
            type: "default",
            animated: false,
            style: {
              stroke: "color-mix(in oklab, var(--foreground) 26%, transparent)",
              strokeWidth: 1.5,
            },
          }))
        : [],
    [projection.edges, showChain]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    []
  );

  // A finger never hovers: it decides whether a drag is a marquee or a pan.
  const hoverCapable = useHoverCapable();
  // Keep the chain in view as it grows or appears; `fitView` alone runs once.
  const nodeCount = showChain ? projection.nodes.length : 0;
  useEffect(() => {
    if (nodeCount === 0) return;
    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.3, maxZoom: 1, duration: 250 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nodeCount, fitView]);

  const onNodeDragStop = useCallback(
    (_event: unknown, node: CanvasNode) => {
      const projected = projection.nodes.find((candidate) => candidate.id === node.id);
      if (!projected) return;
      const action = actionFromNodeId(node.id);
      // Dragging an action along the chain reorders; anything else is a nudge.
      if (action) {
        const reordered = reorderFromDrop(
          draft,
          projection.nodes,
          positions,
          action,
          node.position,
          direction
        );
        if (reordered) {
          handlers.setActions(reordered);
          resetOffset(node.id);
          return;
        }
      }
      persistOffsets({ ...offsets, [node.id]: offsetFor(projected, node.position, direction) });
    },
    [draft, projection.nodes, positions, handlers, offsets, persistOffsets, resetOffset, direction]
  );

  // A palette tile dragged onto the pane inserts at the chain position under
  // the pointer; clicking the tile appends. Same catalogue, same handler.
  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes(PALETTE_ACTION_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);
  const onDrop = useCallback(
    (event: DragEvent) => {
      const action = event.dataTransfer.getData(PALETTE_ACTION_MIME) as FlowAction | "";
      if (!action || !palette.actions.includes(action)) return;
      event.preventDefault();
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const index = dropIndexAt(
        projection.nodes,
        positions,
        direction === "vertical" ? point.y : point.x,
        null,
        direction
      );
      handlers.addAction(action, index);
      setSelectedId(actionNodeId(action));
    },
    [palette.actions, screenToFlowPosition, projection.nodes, positions, handlers, direction]
  );

  const hasOffsets = Object.keys(offsets).length > 0;

  // The box the flow and its field share: scene rectangles are relative to it.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  /**
   * The canvas's single-key shortcuts listen on the window, so they ask this
   * first: focus on the page body or inside the canvas. Without it Backspace on
   * a header button or the Flows Agent's composer removed the selected step.
   */
  const focusOnCanvas = useCallback(() => {
    const active = document.activeElement;
    return !active || active === document.body || Boolean(canvasRef.current?.contains(active));
  }, []);

  /**
   * Tidy up: drop every nudge and put the chain back on its derivation, then
   * bring it into view. The same thing the menu used to call "Reset layout",
   * under the name the picture actually deserves.
   */
  const tidyUp = useCallback(() => {
    persistOffsets({});
    void fitView({ padding: 0.3, maxZoom: 1, duration: 250 });
  }, [persistOffsets, fitView]);

  // Shift+T, the shortcut the control advertises. Not while a field has focus:
  // the node panel is full of them and there T is a letter.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.shiftKey || event.key.toLowerCase() !== "t") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!focusOnCanvas()) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      tidyUp();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tidyUp, focusOnCanvas]);

  // React Flow stamps `.light` / `.dark` on its root for its own variables, and
  // the console's theme scopes *its* tokens on those same class names, so the
  // canvas has to follow the app's resolved theme or every node inside renders
  // in the other mode's colours.
  const { resolvedTheme } = useTheme();
  const colorMode = resolvedTheme === "dark" ? "dark" : "light";

  const selectAndOpen = useCallback(
    (id: string) => {
      setSelectedId(id);
      onOpenPanel();
    },
    [onOpenPanel]
  );
  const deselect = useCallback(() => {
    setSelectedId(null);
    onClosePanel();
  }, [onClosePanel]);

  /**
   * The node panel takes over the screen on the same curve the Preview does:
   * a FLIP over real geometry, not a scale, so the fields inside stay crisp.
   * The panel floats over the canvas rather than being docked to it, so its
   * resting slot is an absolute box and the spacer wears the same classes.
   */
  const { fullscreen, setFullscreen, surfaceRef, animating, spacerRef } = useFullscreenGrow();

  /**
   * Remove one action step, from the keyboard, the `⋯` menu or the context
   * menu. Leave full screen first: the panel is about to unmount, and a fixed
   * panel that vanishes mid-animation leaves the screen blank over the next
   * selection.
   */
  const removeStep = useCallback(
    (action: FlowAction) => {
      setFullscreen(false);
      handlers.removeAction(action);
      deselect();
    },
    [setFullscreen, handlers, deselect]
  );

  // Delete / Backspace removes the selected step, the shortcut the context
  // menu advertises. Never while a field has focus: the node panel is full of
  // them and Backspace there is a character, not a deletion.
  const selectedAction = selectedId ? actionFromNodeId(selectedId) : null;
  useEffect(() => {
    if (readOnly || !selectedAction) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!focusOnCanvas()) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      removeStep(selectedAction!);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly, selectedAction, removeStep, focusOnCanvas]);

  // Full screen covers the page, so it answers Escape the way a dialog does and
  // takes focus with it: a keyboard user left behind on the canvas would be
  // tabbing through controls the panel now hides.
  useEffect(() => {
    if (!fullscreen) return;
    const frame = window.requestAnimationFrame(() =>
      surfaceRef.current?.focus({ preventScroll: true })
    );
    return () => window.cancelAnimationFrame(frame);
  }, [fullscreen, surfaceRef]);

  /**
   * One place a step is added, whichever control asked. `buildByHand` comes
   * with it: adding the first step to a blank canvas is also what turns the
   * prompt box into a chain.
   */
  const addStep = useCallback(
    (choice: FlowStepChoice, index?: number) => {
      setBuildByHand(true);
      switch (choice.kind) {
        case "trigger":
          handlers.chooseTrigger(choice.trigger);
          selectAndOpen(TRIGGER_NODE_ID);
          return;
        case "condition":
          handlers.setConditions([
            ...draft.conditions,
            newFlowCondition(choice.condition, crypto.randomUUID()),
          ]);
          selectAndOpen(CONDITIONS_NODE_ID);
          return;
        case "action":
          handlers.addAction(choice.action, index);
          selectAndOpen(actionNodeId(choice.action));
          return;
        case "connector":
          // A Connector joins the chain like any action, pre-set to the
          // provider the row named; the node panel takes it from there.
          handlers.addAction("connector", index);
          handlers.patchSettings("connector", {
            provider: choice.provider,
            params: {},
          });
          selectAndOpen(actionNodeId("connector"));
      }
    },
    [draft.conditions, handlers, selectAndOpen]
  );

  const entries = useMemo(
    () => flowStepEntries(draft, palette, { isDefaultFlow }),
    [draft, palette, isDefaultFlow]
  );

  /**
   * One of these hangs off every node on hover, at its right edge: adding from
   * a node in the middle of the chain puts the step between that node and the
   * next, and adding from the last one puts it at the end.
   */
  const renderAddStep = useCallback(
    (insertIndex: number) =>
      readOnly ? null : (
        <AddStepControl
          entries={entries}
          onPick={(choice) => addStep(choice, insertIndex)}
          direction={direction}
        />
      ),
    [entries, addStep, readOnly, direction]
  );

  /**
   * What the selected step's `⋯` offers. Everything here is about the one
   * step the panel is showing, which is why it is empty without one.
   */
  const nodeMenu = useMemo<NodeMenuEntry[]>(() => {
    if (!selectedNode) return [];
    const node = selectedNode;
    const action = node.kind === "action" ? node.action! : null;
    const entries: NodeMenuEntry[] = [];
    if (offsets[node.id]) {
      entries.push({
        key: "reset-position",
        label: "Reset position",
        icon: RotateCcw,
        run: () => resetOffset(node.id),
      });
    }
    entries.push({
      key: "preview",
      label: "Open Preview",
      icon: ExternalLink,
      run: onOpenPreview,
    });
    // The keyboard's way to reorder, since dragging along the chain is a
    // pointer gesture. A move re-derives the position, so any nudge on the
    // step goes, the same as a drag that reorders.
    const index = action ? draft.actions.indexOf(action) : -1;
    if (action && !readOnly && index !== -1) {
      const move = (to: number) => {
        handlers.setActions(moveAction(draft.actions, action, to));
        if (offsets[node.id]) resetOffset(node.id);
      };
      const vertical = direction === "vertical";
      if (index > 0) {
        entries.push({
          key: "move-earlier",
          label: "Move earlier",
          icon: vertical ? ArrowUp : ArrowLeft,
          run: () => move(index - 1),
        });
      }
      if (index < draft.actions.length - 1) {
        entries.push({
          key: "move-later",
          label: "Move later",
          icon: vertical ? ArrowDown : ArrowRight,
          run: () => move(index + 1),
        });
      }
    }
    if (action && !readOnly) {
      entries.push({
        key: "remove",
        label: `Remove ${node.title}`,
        icon: Trash2,
        destructive: true,
        run: () => removeStep(action),
      });
    }
    return entries;
  }, [
    selectedNode,
    offsets,
    resetOffset,
    onOpenPreview,
    readOnly,
    handlers,
    removeStep,
    draft.actions,
    direction,
  ]);

  /** Right-click "Open full screen": select the step, then grow its panel. */
  const openNodeFullscreen = useCallback(
    (id: string) => {
      selectAndOpen(id);
      setFullscreen(true);
    },
    [selectAndOpen, setFullscreen]
  );

  const panelShowing = panelOpen && selectedNode !== null;

  return (
    <div className="relative flex min-h-0 flex-1">
      <ContextMenu onOpenChange={(open) => !open && setMenuNodeId(null)}>
      <ContextMenuTrigger>
      <div
        ref={canvasRef}
        data-agent-launcher={!readOnly && showChain && Boolean(onAskAgent) && !agentOpen}
        className="flow-canvas bg-background relative min-w-0 flex-1"
        onDragOver={onDragOver}
        onDrop={onDrop}
        // React Flow selects a focused node on Enter or Space but opens
        // nothing, so the panel a click opens was out of a keyboard's reach.
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          const target = event.target as HTMLElement;
          if (!target.classList?.contains("react-flow__node")) return;
          const id = target.getAttribute("data-id");
          if (id) selectAndOpen(id);
        }}
        // Runs before the trigger opens the menu, so the menu is already
        // scoped by the time it renders.
        onContextMenu={(event) => {
          const node = (event.target as HTMLElement).closest?.(".react-flow__node");
          setMenuNodeId(node?.getAttribute("data-id") ?? null);
        }}
      >
        {/* The floor: dots and lines that pan with the camera and make room
            round every step. It replaces React Flow's own dotted
            `<Background>`, so the flow above it stays transparent. */}
        <FlowCanvasField root={canvasRef} themeKey={colorMode} />
        <AddStepContext.Provider value={renderAddStep}>
          <ReactFlow<CanvasNode, Edge>
            colorMode={colorMode}
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_event, node) => selectAndOpen(node.id)}
            onPaneClick={deselect}
            /* Removal is ours (the window handler above), so React Flow's own
               Backspace deletion never drops a node the draft still holds. */
            deleteKeyCode={null}
            nodesDraggable={!readOnly}
            nodesConnectable={false}
            edgesFocusable={false}
            elementsSelectable
            /* Two-finger scroll pans, the gesture a trackpad already makes
               for moving around a canvas; pinch zooms. Wheel-zoom moves to
               Ctrl+wheel, which is where a canvas usually keeps it. */
            panOnScroll
            zoomOnScroll={false}
            zoomOnPinch
            /* A finger has one gesture, and on a canvas it is pan: a touch
               device gets no marquee, so a drag always moves the view. The
               Select / Hand tools are a pointer distinction and stay one. */
            panOnDrag={!hoverCapable || tool === "hand"}
            selectionOnDrag={hoverCapable && tool === "select"}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={0.4}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            className="!bg-transparent"
          />
        </AddStepContext.Provider>

        {/* Bencho's toolbar replaces both tool pills at the old view controls' position. */}
        <div className="flow-canvas-tools absolute bottom-3 left-3 z-20">
          <CanvasToolbar tool={tool} onToolChange={setTool} readOnly={readOnly}
            pickerOpen={pickerOpen} onPickerOpenChange={setPickerOpen}
            picker={<FlowStepPicker entries={entries} autoFocus={pickerOpen}
              onPick={(choice) => { setPickerOpen(false); addStep(choice); }} />}
            onFit={() => void fitView({ padding: 0.3, maxZoom: 1, duration: 200 })}
            onZoomIn={() => void zoomIn()} onZoomOut={() => void zoomOut()}
            controls={[
              { label: "Tidy up (Shift+T)", icon: Brush, run: tidyUp },
              { label: direction === "vertical" ? "Switch to horizontal layout" : "Switch to vertical layout",
                icon: Workflow, run: () => changeDirection(direction === "vertical" ? "horizontal" : "vertical") },
            ]}
          />
        </div>
        {!readOnly && showChain && onAskAgent && !agentOpen && (
          <div className="flow-canvas-agent pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center">
            <AgentPromptBar onAsk={onAskAgent} />
          </div>
        )}

        {!readOnly &&
          !showChain &&
          (onAskAgent && !agentOpen ? (
            /* The white reference's empty canvas: describe the flow, and the
               Flows Agent drafts it (#838). Nothing else is drawn until the
               Member adds a step; "build by hand" lays down the blank chain. */
            /* The wrapper spans the canvas to centre the card, so it must not
               take the pointer with it: it sat over the bottom bar and ate
               every hover and click meant for the tools. */
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
              <div className="bg-card pointer-events-auto w-full max-w-lg rounded-xl border p-3 shadow-strong">
                <p className="mb-2 px-1 text-sm font-medium">What should this flow do?</p>
                <PromptInput
                  onSubmit={(value) => {
                    if (value.trim()) onAskAgent(value);
                  }}
                  minRows={2}
                  maxRows={5}
                  placeholder="When a visitor asks about refunds, answer from our knowledge and offer the finance desk…"
                  aria-label="Describe the flow for the Flows Agent"
                />
                <p className="text-muted-foreground mt-2 flex items-center gap-1 px-1 text-xs">
                  Or
                  <button
                    type="button"
                    className="press-text text-foreground underline underline-offset-2"
                    onClick={() => setBuildByHand(true)}
                  >
                    build it by hand
                  </button>
                  , one step at a time.
                </p>
              </div>
            </div>
          ) : (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
              <div className="bg-card pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border px-5 py-4 text-center shadow-strong">
                <p className="text-sm font-medium">This flow is empty</p>
                <p className="text-muted-foreground text-xs">
                  {agentOpen
                    ? "Describe it to the Flows Agent, or lay down the first step yourself."
                    : "Lay down the first step, then add actions after it."}
                </p>
                <Button type="button" size="sm" onClick={() => setBuildByHand(true)}>
                  <Plus className="size-4" /> Add the first step
                </Button>
              </div>
            </div>
          ))}

      </div>
      </ContextMenuTrigger>
      <CanvasContextMenu
        node={menuNodeId ? (projection.nodes.find((n) => n.id === menuNodeId) ?? null) : null}
        readOnly={readOnly}
        hasOffsets={hasOffsets}
        offsetForNode={menuNodeId ? Boolean(offsets[menuNodeId]) : false}
        onConfigure={(id) => selectAndOpen(id)}
        onFullscreen={openNodeFullscreen}
        onAddStep={() => setPickerOpen(true)}
        onRemove={removeStep}
        onResetNode={resetOffset}
        onTidyUp={tidyUp}
        onFitView={() => void fitView({ padding: 0.3, maxZoom: 1, duration: 200 })}
        direction={direction}
        onDirectionChange={changeDirection}
        onOpenPreview={onOpenPreview}
      />
      </ContextMenu>

      {/* The node panel: one selected step's settings, floating over the
          canvas rather than docked flush against it. Detached because it is
          about one step and not about the screen: the canvas stays whole
          underneath, the panel keeps its own edges, and full screen is a
          growth from this box rather than a different layout. Because it
          floats here, it claims nothing in the workspace's right rail: the
          Preview or the Flows Agent stays open beside a selected step. */}
      {panelShowing && (
        <>
          {/* The panel is out of flow for the whole grow, so its resting slot
              is measured from this: same box, nothing drawn. */}
          {animating && (
            <div
              ref={spacerRef}
              aria-hidden
              className="pointer-events-none invisible absolute inset-y-3 right-3 z-30 w-[360px] max-w-[calc(100%-1.5rem)] rounded-xl"
            />
          )}
          <div
            ref={surfaceRef}
            tabIndex={-1}
            onKeyDown={(event) => {
              // DOM containment, not React's: a Select inside the panel portals
              // its popup out, and its own Escape must only close that popup.
              if (
                event.key !== "Escape" ||
                !fullscreen ||
                !event.currentTarget.contains(event.target as globalThis.Node)
              )
                return;
              event.preventDefault();
              setFullscreen(false);
            }}
            className={cn(
              "bg-card z-30 flex flex-col overflow-hidden border shadow-strong outline-none",
              fullscreen
                ? "fixed inset-0 z-50 rounded-none"
                : "absolute inset-y-3 right-3 w-[360px] max-w-[calc(100%-1.5rem)] rounded-xl"
            )}
          >
            <NodePanel
              node={selectedNode}
              assistantId={assistantId}
              flowId={flowId}
              draft={draft}
              status={status}
              isDefaultFlow={isDefaultFlow}
              readOnly={readOnly}
              helpDesks={helpDesks}
              faqs={faqs}
              assistants={assistants}
              connections={connections}
              handlers={handlers}
              menu={nodeMenu}
              fullscreen={fullscreen}
              onFullscreenChange={setFullscreen}
              onClose={() => (fullscreen ? setFullscreen(false) : deselect())}
              onOpenPreview={onOpenPreview}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** The canvas's round, quiet icon buttons: panel controls and the step menu. */
const ROUND_ICON_BUTTON =
  "press-control text-muted-foreground hover:text-foreground hover:bg-foreground/5 flex size-8 items-center justify-center rounded-full transition-colors";

/**
 * The selected step's `⋯`, in a dropdown. The same entries reach the
 * right-click menu through `CanvasContextMenu`, which renders them as context
 * items: one offer, two primitives.
 */
function NodeMenu({
  entries,
  side,
}: {
  entries: NodeMenuEntry[];
  side: "bottom" | "right" | "top";
}) {
  if (entries.length === 0) return null;
  return (
    <DropdownMenu>
      <Hint label="Step options" side={side}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Step options"
              className={ROUND_ICON_BUTTON}
            />
          }
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent side={side} align="end" className="w-52">
        {entries.map((entry) => (
          <DropdownMenuItem
            key={entry.key}
            variant={entry.destructive ? "destructive" : "default"}
            onClick={entry.run}
          >
            <entry.icon className="size-4" /> {entry.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The canvas's right-click menu, the same component the Assistants grid uses.
 *
 * One menu, two scopes: the pane's, and one step's, decided by what the click
 * landed on rather than by a second trigger stacked over the same pixels. What
 * it offers is what the canvas can already do, reached where the pointer is:
 * a step's settings and its removal, Add a step (which opens the bottom bar's
 * own picker rather than a second copy of it), the view controls, and the
 * Preview.
 *
 * A Viewer gets the read-only half: fit, reset and Preview, but nothing that
 * edits, so the menu never offers an action the save would refuse.
 */
function CanvasContextMenu({
  node,
  readOnly,
  hasOffsets,
  offsetForNode,
  onConfigure,
  onFullscreen,
  onAddStep,
  onRemove,
  onResetNode,
  onTidyUp,
  onFitView,
  direction,
  onDirectionChange,
  onOpenPreview,
}: {
  node: FlowCanvasNode | null;
  readOnly: boolean;
  hasOffsets: boolean;
  /** Whether the targeted node has been dragged off its derived position. */
  offsetForNode: boolean;
  onConfigure: (nodeId: string) => void;
  /** Opens the step's panel straight into full screen. */
  onFullscreen: (nodeId: string) => void;
  onAddStep: () => void;
  onRemove: (action: FlowAction) => void;
  onResetNode: (nodeId: string) => void;
  /** Drops every nudge and re-derives the chain. */
  onTidyUp: () => void;
  onFitView: () => void;
  direction: CanvasDirection;
  onDirectionChange: (next: CanvasDirection) => void;
  onOpenPreview: () => void;
}) {
  const action = node?.kind === "action" ? node.action! : null;
  return (
    <ContextMenuContent
      ariaLabel={node ? `Actions for ${node.title}` : "Canvas actions"}
      className="w-60"
    >
      {node && (
        <>
          <ContextMenuLabel><RollInText text={node.title} /></ContextMenuLabel>
          <ContextMenuItem textValue="Configure" onSelect={() => onConfigure(node.id)}>
            <SlidersHorizontal className="size-4" /> Configure
          </ContextMenuItem>
          {/* The panel's own two controls, reached from the pointer: the same
              pair the panel header and the bottom-left pill carry. */}
          <ContextMenuItem
            textValue="Open full screen"
            onSelect={() => onFullscreen(node.id)}
          >
            <Maximize2 className="size-4" /> Open full screen
          </ContextMenuItem>
          {offsetForNode && (
            <ContextMenuItem
              textValue="Reset position"
              onSelect={() => onResetNode(node.id)}
            >
              <RotateCcw className="size-4" /> Reset position
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
        </>
      )}

      {!readOnly && (
        <ContextMenuItem textValue="Add a step" onSelect={onAddStep}>
          <Plus className="size-4" /> Add a step
        </ContextMenuItem>
      )}
      <ContextMenuItem textValue="Fit to view" onSelect={onFitView}>
        <Maximize className="size-4" /> Fit to view
      </ContextMenuItem>
      <ContextMenuItem textValue="Tidy up" disabled={!hasOffsets} onSelect={onTidyUp}>
        <Brush className="size-4" /> Tidy up
        <ContextMenuShortcut>⇧T</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        textValue="Switch layout"
        onSelect={() =>
          onDirectionChange(direction === "vertical" ? "horizontal" : "vertical")
        }
      >
        <Workflow className="size-4" />
        {direction === "vertical" ? "Switch to horizontal layout" : "Switch to vertical layout"}
      </ContextMenuItem>
      <ContextMenuItem textValue="Open Preview" onSelect={onOpenPreview}>
        <ExternalLink className="size-4" /> Open Preview
      </ContextMenuItem>

      {action && !readOnly && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            textValue="Remove step"
            tone="destructive"
            onSelect={() => onRemove(action)}
          >
            <Trash2 className="size-4" /> Remove step
            <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}

/**
 * The canvas's line to the Flows Agent: Bencho's liquid command bar centered
 * below the Flow. Submitting opens the agent
 * in the right-hand panel with this as its first message, so this is a launcher
 * rather than a second transcript, and it takes no attachments and shows no
 * history.
 */
function AgentPromptBar({ onAsk }: { onAsk: (message: string) => void }) {
  return (
    <CommandBar
      onSubmit={onAsk}
      width="min(26rem,calc(100% - 8rem))"
      placeholder="Ask the Flows Agent to change this flow…"
      label="Ask the Flows Agent"
    />
  );
}

/** The glyph for one kind of step. */
function stepIcon(choice: FlowStepChoice) {
  switch (choice.kind) {
    case "trigger":
      return MousePointerClick;
    case "condition":
      return ListFilter;
    case "connector":
      return Unplug;
    case "action":
      return FLOW_ACTIONS[choice.action].icon;
  }
}

/**
 * A node's own Add control: a `+` on the wire just past the card's right edge,
 * revealed by hovering that card.
 *
 * Where it sits is what it means. Adding from a node in the middle of the chain
 * puts the step between that node and the next; adding from the last one puts
 * it at the end. Same catalogue as the bottom bar's, so the position is the
 * only difference between them.
 */
function AddStepControl({
  entries,
  onPick,
  direction,
}: {
  entries: FlowStepEntry[];
  onPick: (choice: FlowStepChoice) => void;
  /** Which edge of the card it hangs off: the one the next step is on. */
  direction: CanvasDirection;
}) {
  const [open, setOpen] = useState(false);
  return (
    // Shown on hover of the card (this is its descendant, so hovering the
    // control keeps the card hovered), on keyboard focus, and while the menu is
    // open. `nodrag`/`nopan` keep React Flow from reading the press as a drag;
    // this wrapper is what the drag listener sees, so they go here.
    <div
      className={cn(
        "nodrag nopan pointer-events-auto absolute z-10 flex items-center transition-opacity duration-150 motion-reduce:transition-none",
        direction === "vertical"
          ? "top-full left-1/2 -translate-x-1/2 pt-2"
          : "top-1/2 left-full -translate-y-1/2 pl-2",
        open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
      )}
      // The control sits inside the card, so a press on it would otherwise
      // also select that node and swap the panel under the menu.
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <Hint label="Add a step" side="top">
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label="Add a step"
                className="press-control flex items-center justify-center rounded-full transition-[filter] hover:brightness-110 bg-primary text-primary-foreground ring-background size-6 shadow-light ring-2"
              />
            }
          >
            <Plus className="size-3.5" />
          </PopoverTrigger>
        </Hint>
        {/* `overflow-hidden` turns off the popup's own scroller: the list below
            has one, and two nested scrollers let the outer one carry the inner
            one's focused row into view, which opened the menu halfway down. */}
        <PopoverContent
          side="top"
          align="center"
          sideOffset={10}
          className="w-80 overflow-hidden p-0"
        >
          <FlowStepPicker
            entries={entries}
            onPick={(choice) => {
              setOpen(false);
              onPick(choice);
            }}
            autoFocus={open}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * The step picker: search, group chips, grouped rows.
 *
 * The list is `flowStepEntries`, which is `paletteForDraft` flattened, so it
 * offers exactly what a save would accept and nothing else: a step already in
 * the chain, or one this trigger cannot run, is not in it to be found. Rows
 * stay draggable, which is how a step is inserted *between* two others rather
 * than appended.
 */
function FlowStepPicker({
  entries,
  onPick,
  autoFocus,
}: {
  entries: FlowStepEntry[];
  onPick: (choice: FlowStepChoice) => void;
  /** False while the picker is mounted but clipped, so it never steals focus. */
  autoFocus: boolean;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<FlowStepGroup | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!autoFocus || !canAutoFocus()) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);
  const available = useMemo(() => flowStepGroupsOf(entries), [entries]);
  const shown = useMemo(
    () => filterFlowStepEntries(entries, query, group),
    [entries, query, group]
  );
  const groups = flowStepGroupsOf(shown);

  return (
    <div className="flex max-h-[min(26rem,60vh)] flex-col">
      <div className="p-2 pb-0">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search steps…"
            aria-label="Search steps"
            className="h-9 pl-8"
          />
        </div>
      </div>

      {/* A clear gap under the search box: the chips narrow what the box
          searches, and reading as one control with it made them look like part
          of the field. */}
      {available.length > 1 && (
        <div className="flex flex-wrap gap-1 px-2 pt-2.5 pb-2.5">
          {[null, ...available].map((option) => (
            <button
              key={option ?? "all"}
              type="button"
              aria-pressed={group === option}
              onClick={() => setGroup(option)}
              className={cn(
                "press-control rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                group === option
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option ?? "All"}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {shown.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm break-words">
            {entries.length === 0
              ? "Every step this trigger can run is already in the chain."
              : `No step matches “${query}”.`}
          </p>
        ) : (
          groups.map((heading) => (
            <div key={heading}>
              <p className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-medium">
                {heading}
              </p>
              {shown
                .filter((entry) => entry.group === heading)
                .map((entry) => {
                  const Icon = stepIcon(entry.choice);
                  const action =
                    entry.choice.kind === "action" ? entry.choice.action : null;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      draggable={action !== null}
                      onDragStart={
                        action
                          ? (event) => {
                              event.dataTransfer.setData(PALETTE_ACTION_MIME, action);
                              event.dataTransfer.effectAllowed = "move";
                            }
                          : undefined
                      }
                      onClick={() => onPick(entry.choice)}
                      className={cn(
                        "hover:bg-accent press flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                        action && "cursor-grab active:cursor-grabbing"
                      )}
                    >
                      {/* A fixed tile, not a bare glyph: every row's label then
                          starts at the same x whatever the icon's own width. */}
                      {/* `foreground/10`, not `bg-muted`: inside a popover
                          `muted` resolves to the popup's own background, so
                          the tile was invisible in dark mode. */}
                      <span className="bg-foreground/10 text-foreground/80 flex size-8 shrink-0 items-center justify-center rounded-lg">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span className="truncate">{entry.label}</span>
                          {action && FLOW_ACTIONS[action].beta && (
                            <Badge
                              variant="outline"
                              className="text-muted-foreground rounded-full"
                            >
                              beta
                            </Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {entry.subtitle}
                        </span>
                      </span>
                    </button>
                  );
                })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function NodePanel({
  node,
  assistantId,
  flowId,
  draft,
  status,
  isDefaultFlow,
  readOnly,
  helpDesks,
  faqs,
  assistants,
  connections,
  handlers,
  menu,
  fullscreen,
  onFullscreenChange,
  onClose,
  onOpenPreview,
}: {
  node: FlowCanvasNode;
  assistantId: string;
  /** Null for an unsaved Flow, which has no HTTP endpoint yet (#843). */
  flowId: string | null;
  connections: ConnectorConnectionOption[];
  draft: FlowDraft;
  status: FlowDraftStatus;
  isDefaultFlow: boolean;
  readOnly: boolean;
  helpDesks: HelpDeskOption[];
  faqs: FaqOption[];
  assistants: AssistantOption[];
  handlers: FlowStepHandlers;
  /** This step's overflow entries, shared with the canvas's other two menus. */
  menu: NodeMenuEntry[];
  fullscreen: boolean;
  onFullscreenChange: (next: boolean) => void;
  /** Close the panel, or leave full screen first when it is showing. */
  onClose: () => void;
  onOpenPreview: () => void;
}) {
  const action = node.kind === "action" ? node.action! : null;
  const Icon = action ? FLOW_ACTIONS[action].icon : NODE_ICONS[node.kind];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Icon className="text-muted-foreground size-4 shrink-0" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold"><RollInText text={node.title} /></h2>
        {node.status === "needs_setup" && (
          <StatusPill status="error" primaryText="Needs setup" />
        )}
        {node.status === "preview_only" && (
          <StatusPill status="warning" primaryText="Preview only" />
        )}
        {/* Removing lives in the `⋯` now, beside the step's other options,
            rather than as a bare destructive button one pixel from Close. */}
        <NodeMenu entries={menu} side="bottom" />
        <Hint label={fullscreen ? "Exit full screen" : "Open full screen"}>
          <button
            type="button"
            aria-label={fullscreen ? "Exit full screen" : "Open full screen"}
            onClick={() => onFullscreenChange(!fullscreen)}
            className="press-control text-muted-foreground hover:text-foreground hover:bg-foreground/5 flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
          >
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        </Hint>
        <Hint label={fullscreen ? "Exit full screen" : "Close"}>
          <button
            type="button"
            aria-label="Close node panel"
            onClick={onClose}
            className="press-control text-muted-foreground hover:text-foreground hover:bg-foreground/5 flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
          >
            <X className="size-4" />
          </button>
        </Hint>
      </div>

      <Tabs defaultValue="configure" className="flex min-h-0 flex-1 flex-col">
        <TabsList aria-label="Flow node view" wrapperClassName="mx-4 mt-3 w-auto">
          <TabsTrigger value="configure">Configure</TabsTrigger>
          <TabsTrigger value="run">Run node</TabsTrigger>
        </TabsList>
        <TabsContent value="configure" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4">
          {/* A disabled fieldset is the read-only rendering: same fields, no edits. */}
          <fieldset disabled={readOnly} className="min-w-0">
            {node.kind === "trigger" && (
              <FlowTriggerConfig
                isDefaultFlow={isDefaultFlow}
                trigger={draft.trigger}
                dwell={draft.dwell}
                dwellOk={status.dwellOk}
                proactive={status.proactive}
                onChoose={handlers.chooseTrigger}
                onRemove={handlers.removeTrigger}
                onDwellChange={handlers.setDwell}
                httpMethods={draft.httpMethods}
                flowId={flowId}
                onHttpMethodsChange={handlers.setHttpMethods}
              />
            )}
            {node.kind === "conditions" && (
              <FlowConditionsConfig
                isDefaultFlow={isDefaultFlow}
                trigger={draft.trigger}
                proactive={status.proactive}
                conditionLogic={draft.conditionLogic}
                conditions={draft.conditions}
                onLogicChange={handlers.setConditionLogic}
                onConditionsChange={handlers.setConditions}
              />
            )}
            {action &&
              (actionHasConfig(action) ? (
                <FlowActionConfig
                  action={action}
                  assistantId={assistantId}
                  settings={draft.settings}
                  customMessage={draft.customMessage}
                  helpDesks={helpDesks}
                  faqs={faqs}
                  assistants={assistants}
                  connections={connections}
                  onPatchSettings={handlers.patchSettings}
                  onCustomMessageChange={handlers.setCustomMessage}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  {FLOW_ACTIONS[action].subtitle}. Nothing to configure.
                </p>
              ))}
          </fieldset>
        </TabsContent>
        <TabsContent value="run" className="mt-0 min-h-0 flex-1 overflow-y-auto p-4">
          <RunNode action={action} draft={draft} onOpenPreview={onOpenPreview} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Run node: one node, alone. API request reuses the form's Test request (the
 * same server call with sample template values); Search knowledge hands off to
 * the Preview, which is the one place a retrieval already runs end to end.
 */
function RunNode({
  action,
  draft,
  onOpenPreview,
}: {
  action: FlowAction | null;
  draft: FlowDraft;
  onOpenPreview: () => void;
}) {
  if (action === "api_request") {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Sends the request as configured, with sample values for template variables.
        </p>
        <TestRequestControl settings={draft.settings.api_request ?? {}} />
      </div>
    );
  }
  if (action === "connector") {
    return <TestConnectorControl settings={draft.settings.connector} />;
  }
  if (action === "human_review") {
    return <HumanReviewPreview draft={draft} />;
  }
  if (action === "search_knowledge") {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Test it in the Preview: ask the question this flow should answer and watch the Thinking panel.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onOpenPreview}>
          <ExternalLink className="size-4" /> Open Preview
        </Button>
      </div>
    );
  }
  return (
    <p className="text-muted-foreground text-sm">
      {action
        ? `${FLOW_ACTIONS[action].label} runs only inside a conversation. Save the flow and try it in the Preview.`
        : "This step has nothing to run on its own. Save the flow and try it in the Preview."}
    </p>
  );
}
