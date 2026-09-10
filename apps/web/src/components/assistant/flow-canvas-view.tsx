"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { useTheme } from "@/components/theme-provider";
import type { FlowAction } from "@agent-hub/core";
import {
  Background,
  BackgroundVariant,
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
import {
  AlertCircle,
  ArrowUp,
  Brush,
  Ellipsis,
  ExternalLink,
  Hand,
  LayoutGrid,
  ListFilter,
  Maximize,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  MousePointerClick,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Unplug,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Badge, Button, Hint, Input } from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFullscreenGrow } from "@/components/chat/use-fullscreen-grow";
import { useDeferredStoredValue } from "@/components/assistant/use-deferred-stored-value";
import { FLOW_ACTIONS } from "@/lib/flow-actions";
import { PromptInput } from "@/components/agents/prompt-input";
import { motion, useReducedMotion } from "motion/react";
import { EASE_GROW, EASE_OUT, GROW_DURATION_MS, SPRING_LAYOUT } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
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
  localId,
  type AssistantOption,
  type FaqOption,
  type FlowStepHandlers,
  type HelpDeskOption,
} from "@/components/assistant/flow-step-config";
import type { ConnectorConnectionOption } from "@/lib/connector-options";
import { TestConnectorControl } from "@/components/assistant/flow-connector-config";
import { HumanReviewPreview } from "@/components/assistant/flow-human-review-config";

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
      className={cn(
        "bg-card press group relative flex items-start gap-3 rounded-xl border px-3.5 py-3 shadow-sm transition-colors",
        data.selected ? "border-primary ring-primary/30 ring-2" : "hover:border-foreground/30"
      )}
      style={{ width: CANVAS_NODE_WIDTH }}
    >
      {renderAddStep?.(data.insertIndex)}
      {data.kind !== "trigger" && (
        <Handle
          type="target"
          position={data.direction === "vertical" ? Position.Top : Position.Left}
          className="!bg-muted-foreground/60 !size-2.5 !border-0"
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
          <span className="truncate text-sm font-semibold">{data.title}</span>
          {data.kind === "action" && data.action && FLOW_ACTIONS[data.action].beta && (
            <Badge variant="outline" className="text-muted-foreground rounded-full">
              beta
            </Badge>
          )}
        </span>
        <span className="text-muted-foreground block truncate text-xs">{data.subtitle}</span>
        {data.status === "needs_setup" && (
          <span className="text-destructive mt-1.5 inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/5 px-1.5 py-0.5 text-[11px] font-medium">
            <AlertCircle className="size-3" /> Needs setup
          </span>
        )}
        {data.status === "preview_only" && (
          <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
            <AlertCircle className="size-3" /> Preview only
          </span>
        )}
      </span>
      <Handle
        type="source"
        position={data.direction === "vertical" ? Position.Bottom : Position.Right}
        className="!bg-muted-foreground/60 !size-2.5 !border-0"
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
  agentOpen?: boolean;
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
  agentOpen = false,
}: FlowCanvasViewProps) {
  const projection = useMemo(
    () => projectFlowCanvas(draft, { isDefaultFlow }),
    [draft, isDefaultFlow]
  );
  const palette = useMemo(
    () => paletteForDraft(draft, { isDefaultFlow }),
    [draft, isDefaultFlow]
  );
  const { screenToFlowPosition } = useReactFlow();

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
            style: { stroke: "var(--muted-foreground)", strokeOpacity: 0.5, strokeWidth: 1.5 },
          }))
        : [],
    [projection.edges, showChain]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) =>
      setNodes((current) => applyNodeChanges(changes, current)),
    []
  );

  // Keep the chain in view as it grows or appears; `fitView` alone runs once.
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  // A finger never hovers: it decides whether a drag is a marquee or a pan.
  const hoverCapable = useHoverCapable();
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
          const next = { ...offsets };
          delete next[node.id];
          persistOffsets(next);
          return;
        }
      }
      persistOffsets({ ...offsets, [node.id]: offsetFor(projected, node.position, direction) });
    },
    [draft, projection.nodes, positions, handlers, offsets, persistOffsets, direction]
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
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      tidyUp();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tidyUp]);

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

  // Delete / Backspace removes the selected step, the shortcut the context
  // menu advertises. Never while a field has focus: the node panel is full of
  // them and Backspace there is a character, not a deletion.
  const selectedAction = selectedId ? actionFromNodeId(selectedId) : null;
  useEffect(() => {
    if (readOnly || !selectedAction) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      handlers.removeAction(selectedAction!);
      deselect();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly, selectedAction, handlers, deselect]);

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
            newFlowCondition(choice.condition, localId()),
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
          label="Add a step"
          direction={direction}
          className="bg-primary text-primary-foreground ring-background size-6 shadow-sm ring-2"
          iconClassName="size-3.5"
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
        run: () => {
          const next = { ...offsets };
          delete next[node.id];
          persistOffsets(next);
        },
      });
    }
    entries.push({
      key: "preview",
      label: "Open Preview",
      icon: ExternalLink,
      run: onOpenPreview,
    });
    if (action && !readOnly) {
      entries.push({
        key: "remove",
        label: `Remove ${node.title}`,
        icon: Trash2,
        destructive: true,
        run: () => {
          // Leave full screen first: the panel is about to unmount, and a
          // fixed panel that vanishes mid-animation leaves the screen blank.
          setFullscreen(false);
          handlers.removeAction(action);
          deselect();
        },
      });
    }
    return entries;
  }, [
    selectedNode,
    offsets,
    persistOffsets,
    onOpenPreview,
    readOnly,
    handlers,
    deselect,
    setFullscreen,
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
        className="relative min-w-0 flex-1"
        onDragOver={onDragOver}
        onDrop={onDrop}
        // Runs before the trigger opens the menu, so the menu is already
        // scoped by the time it renders.
        onContextMenu={(event) => {
          const node = (event.target as HTMLElement).closest?.(".react-flow__node");
          setMenuNodeId(node?.getAttribute("data-id") ?? null);
        }}
      >
        <AddStepContext.Provider value={renderAddStep}>
          <ReactFlow<CanvasNode, Edge>
            colorMode={colorMode}
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_event, node) => {
              setSelectedId(node.id);
              onOpenPanel();
            }}
            onPaneClick={deselect}
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
            className="bg-background"
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
          </ReactFlow>
        </AddStepContext.Provider>

        {/* The bottom bar: the pointer tools and Add on the left, and, once
            the Flow has something in it, the line to the Flows Agent on the
            right. Adding a step is a canvas gesture, so it belongs here beside
            the other canvas gestures rather than in a rail the Preview wants. */}
        {/* `z-20`: the empty-state card is painted after this row, and the
            step picker grows up through the space that card occupies. */}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex items-end justify-center gap-2">
          <CanvasToolbar
            tool={tool}
            onToolChange={setTool}
            entries={entries}
            onPick={addStep}
            readOnly={readOnly}
            pickerOpen={pickerOpen}
            onPickerOpenChange={setPickerOpen}
          />

          {/* Same prompt the empty canvas offers, kept within reach once the
              canvas is no longer empty: Enter hands it to the Flows Agent,
              which opens in the right-hand panel. */}
          {!readOnly && showChain && onAskAgent && !agentOpen && (
            <AgentPromptBar onAsk={onAskAgent} />
          )}
        </div>

        {/* Zoom and fit, in the same pill the tools wear. React Flow's own
            `Controls` is a square stack with its own colours, and it was the
            one control on this screen that did not look like the product. */}
        <div className="bg-card absolute bottom-3 left-3 flex flex-col items-center rounded-full border p-1 shadow-sm">
          {(
            [
              { label: "Zoom in", icon: Plus, run: () => void zoomIn() },
              { label: "Zoom out", icon: Minus, run: () => void zoomOut() },
              {
                label: "Fit to view",
                icon: Maximize,
                run: () => void fitView({ padding: 0.3, maxZoom: 1, duration: 200 }),
              },
              {
                label: "Tidy up (Shift+T)",
                icon: Brush,
                run: tidyUp,
              },
              {
                label:
                  direction === "vertical"
                    ? "Switch to horizontal layout"
                    : "Switch to vertical layout",
                icon: Workflow,
                run: () =>
                  changeDirection(direction === "vertical" ? "horizontal" : "vertical"),
              },
            ] as const
          ).map((control) => (
            <Hint key={control.label} label={control.label} side="right">
              <button
                type="button"
                aria-label={control.label}
                onClick={control.run}
                className="press-control text-muted-foreground hover:text-foreground hover:bg-foreground/5 flex size-8 items-center justify-center rounded-full transition-colors"
              >
                <control.icon className="size-4" />
              </button>
            </Hint>
          ))}

          {/* The panel's own two controls, repeated where the canvas keeps its
              other controls: with the panel full screen its header is off in
              the corner, and this pill is where a Member already looks. Only
              while a step is selected, since both are about that step. */}
          {panelShowing && (
            <>
              <span aria-hidden className="bg-border my-1 h-px w-5" />
              <Hint
                label={fullscreen ? "Exit full screen" : "Open full screen"}
                side="right"
              >
                <button
                  type="button"
                  aria-label={fullscreen ? "Exit full screen" : "Open full screen"}
                  onClick={() => setFullscreen(!fullscreen)}
                  className="press-control text-muted-foreground hover:text-foreground hover:bg-foreground/5 flex size-8 items-center justify-center rounded-full transition-colors"
                >
                  {fullscreen ? (
                    <Minimize2 className="size-4" />
                  ) : (
                    <Maximize2 className="size-4" />
                  )}
                </button>
              </Hint>
              <NodeMenu entries={nodeMenu} side="right" align="end" />
            </>
          )}
        </div>

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
              <div className="bg-card pointer-events-auto w-full max-w-lg rounded-xl border p-3 shadow-lg">
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
              <div className="bg-card pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border px-5 py-4 text-center shadow-lg">
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
        onRemove={(action) => {
          handlers.removeAction(action);
          deselect();
        }}
        onResetNode={(id) => {
          const next = { ...offsets };
          delete next[id];
          persistOffsets(next);
        }}
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
            className={cn(
              "bg-card z-30 flex flex-col overflow-hidden border shadow-xl",
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

/**
 * The selected step's `⋯`, in a dropdown. The same entries reach the
 * right-click menu through `CanvasContextMenu`, which renders them as context
 * items: one offer, two primitives.
 */
function NodeMenu({
  entries,
  side = "bottom",
  align = "end",
  className,
}: {
  entries: NodeMenuEntry[];
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
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
              className={cn(
                "press-control text-muted-foreground hover:text-foreground hover:bg-foreground/5 flex size-8 items-center justify-center rounded-full transition-colors",
                className
              )}
            />
          }
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent side={side} align={align} className="w-52">
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
          <ContextMenuLabel>{node.title}</ContextMenuLabel>
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
 * The canvas's bottom-left pill: the pointer tools and Add.
 *
 * Icons only at rest, and the labels unfold on hover, so the bar names its
 * controls without spending the canvas's width on three words that are read
 * once. A resting pointer is the reveal, which is why it is gated on
 * `useHoverCapable`: a finger never hovers, and a bar that expanded on tap
 * would swallow the first tap on every control. Touch therefore keeps the
 * plain icon buttons, with their tooltips.
 *
 * The pill behind the highlighted control is one `layoutId`, so it slides from
 * control to control rather than cross-fading, and the whole track animates its
 * own width as the labels arrive.
 */
/** Geometry of the expanding shell, in px, so the open size is arithmetic. */
const BAR_HEIGHT = 40;
/** Gap between the panel and the bar docked under it. */
const PANEL_GAP = 4;
/** The shell's padding (`p-1`) counted on both sides. */
const SHELL_PADDING = 8;
/** The step picker's own width; the shell takes it when it opens. */
const PANEL_WIDTH = 320;

/**
 * The shell grows on the product's growth curve: the same overshoot the
 * Preview takes into full screen, so a surface opening reads the same way
 * wherever it happens. A spring here settled slowly and fought the label
 * motion running beside it, which is what made the bar feel heavy.
 */
const SHELL_GROW = { duration: GROW_DURATION_MS / 1000, ease: EASE_GROW } as const;
/** The panel's own fade rides in a little ahead of the box it fills. */
const PANEL_GROW = { duration: 0.26, ease: EASE_OUT } as const;
/** The labels unfold on the same curve, quicker: they are small and there are three. */
const LABEL_GROW = { duration: 0.26, ease: EASE_GROW } as const;

/** An element's rendered size, tracked live. */
function useMeasuredSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    setSize((current) =>
      current.width === next.width && current.height === next.height ? current : next
    );
  }, []);
  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  return [ref, size] as const;
}

/**
 * The canvas's bottom-left bar: the pointer tools, and Add, which is the one
 * control that expands.
 *
 * Add does not open a menu floating over the canvas; the bar itself grows
 * upwards into it, docking the picker above the same row of controls. A menu
 * that appears somewhere else is a second surface to find, where this one is
 * the control the Member already has their pointer on, made bigger. Only Add
 * expands: Select and Pan act on the click and have nothing to show.
 *
 * At rest the bar is icons only, and the labels unfold on a resting pointer,
 * so it names its controls without spending the canvas's width on three words
 * read once. That is gated on `useHoverCapable`: a finger never hovers, and a
 * bar that expanded on tap would swallow the first tap on every control.
 *
 * The open size is arithmetic over one measurement (the picker's height) rather
 * than a second, hidden copy of the picker: the panel stays mounted and
 * clipped, `inert` while closed, so it is measured before it is ever shown and
 * the shell knows its target on the first frame.
 */
function CanvasToolbar({
  tool,
  onToolChange,
  entries,
  onPick,
  readOnly,
  pickerOpen,
  onPickerOpenChange,
}: {
  tool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  entries: FlowStepEntry[];
  onPick: (choice: FlowStepChoice) => void;
  readOnly: boolean;
  /** Owned by the canvas: the context menu's "Add a step" opens this too. */
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
}) {
  const hoverCapable = useHoverCapable();
  const reduce = useReducedMotion() ?? false;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [panelRef, panelSize] = useMeasuredSize<HTMLDivElement>();
  const [barRef, barSize] = useMeasuredSize<HTMLDivElement>();

  const open = pickerOpen && !readOnly;
  // An open panel holds the labels out: they would otherwise fold away the
  // moment the pointer left the row for the list above it.
  const expanded = hoverCapable && (hovered || focused || open);

  // Outside press and Escape close it, the way an open menu behaves.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!shellRef.current?.contains(event.target as globalThis.Node | null)) {
        onPickerOpenChange(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onPickerOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onPickerOpenChange]);

  const tools = [
    { id: "select", label: "Select", icon: MousePointer2 },
    { id: "hand", label: "Pan", icon: Hand },
  ] as const;
  const active = highlighted ?? tool;

  const closedWidth = barSize.width;
  const target = open
    ? {
        width: Math.max(closedWidth, PANEL_WIDTH + SHELL_PADDING),
        height: panelSize.height + PANEL_GAP + BAR_HEIGHT,
      }
    : { width: closedWidth, height: BAR_HEIGHT };

  return (
    <motion.div
      ref={shellRef}
      initial={false}
      animate={barSize.width > 0 ? target : undefined}
      transition={reduce ? { duration: 0 } : SHELL_GROW}
      style={{ transformOrigin: "bottom center" }}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setHovered(false);
        setHighlighted(null);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // `globalThis.Node`: React Flow's `Node` is imported here and shadows
        // the DOM one.
        if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null))
          setFocused(false);
      }}
      className="bg-card pointer-events-auto flex flex-col overflow-hidden rounded-[20px] border shadow-sm"
    >
      {/* The panel region takes whatever height the shell has beyond the bar,
          and the panel is docked to its bottom edge, so the list grows up out
          of the controls instead of appearing beside them. Always mounted, so
          its height is known before it is ever shown, and `inert` while
          clipped so nothing in it takes focus or a click. */}
      <div className="relative min-h-0 flex-1">
        <motion.div
          aria-hidden={!open}
          inert={!open}
          initial={false}
          animate={
            open
              ? { opacity: 1, y: 0, filter: "blur(0px)" }
              : { opacity: 0, y: -8, filter: reduce ? "blur(0px)" : "blur(4px)" }
          }
          transition={reduce ? { duration: 0.12, ease: EASE_OUT } : PANEL_GROW}
          style={{ transformOrigin: "top center" }}
          className="absolute inset-x-1 bottom-0"
        >
          <div ref={panelRef} style={{ width: PANEL_WIDTH }}>
            <FlowStepPicker
              entries={entries}
              onPick={(choice) => {
                onPickerOpenChange(false);
                onPick(choice);
              }}
              autoFocus={open}
            />
          </div>
        </motion.div>
      </div>

      <div className="flex shrink-0 justify-center" style={{ height: BAR_HEIGHT }}>
        <div
          ref={barRef}
          role="toolbar"
          aria-label="Canvas tool"
          className="flex w-max items-center gap-0.5 p-1"
        >
          {tools.map((option) => (
            <Hint key={option.id} label={option.label} side="top">
              <button
                type="button"
                aria-label={option.label}
                aria-pressed={tool === option.id}
                onClick={() => onToolChange(option.id)}
                onPointerEnter={() => setHighlighted(option.id)}
                className={cn(
                  "press-control relative isolate flex h-8 items-center justify-center rounded-full px-2 text-sm font-medium transition-colors",
                  tool === option.id
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {active === option.id && (
                  <motion.span
                    aria-hidden
                    layoutId="canvas-tool-highlight"
                    transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                    className="bg-primary/10 absolute inset-0 -z-10 rounded-full"
                  />
                )}
                <option.icon className="size-4 shrink-0" />
                <ToolbarLabel expanded={expanded} reduce={reduce}>
                  {option.label}
                </ToolbarLabel>
              </button>
            </Hint>
          ))}
          {!readOnly && (
            <>
              <span aria-hidden className="bg-border mx-1 h-5 w-px shrink-0" />
              {/* No tooltip: this control carries its name inline once the bar
                  is hovered, and a bubble over an already-labelled pill was a
                  second, emptier label floating above it. */}
              <button
                type="button"
                aria-label="Add a step"
                aria-expanded={open}
                onClick={() => onPickerOpenChange(!open)}
                onPointerEnter={() => setHighlighted("add")}
                className="press-control bg-primary text-primary-foreground flex h-8 items-center justify-center rounded-full px-2 text-sm font-medium transition-[filter] hover:brightness-110"
              >
                <motion.span
                  aria-hidden
                  animate={{ rotate: open ? 45 : 0 }}
                  transition={reduce ? { duration: 0 } : LABEL_GROW}
                  className="flex shrink-0"
                >
                  <Plus className="size-4" />
                </motion.span>
                <ToolbarLabel expanded={expanded} reduce={reduce}>
                  Add a step
                </ToolbarLabel>
              </button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** A control's name, folded away until the bar is hovered. */
function ToolbarLabel({
  expanded,
  reduce,
  children,
}: {
  expanded: boolean;
  reduce: boolean;
  children: ReactNode;
}) {
  return (
    <motion.span
      aria-hidden={!expanded}
      animate={{
        width: expanded ? "auto" : 0,
        opacity: expanded ? 1 : 0,
        marginLeft: expanded ? 6 : 0,
        ...(reduce ? {} : { filter: expanded ? "blur(0px)" : "blur(3px)" }),
      }}
      initial={false}
      transition={reduce ? { duration: 0 } : LABEL_GROW}
      className="inline-block overflow-hidden whitespace-nowrap"
    >
      {children}
    </motion.span>
  );
}

/**
 * The canvas's line to the Flows Agent: one row, the same height as the tool
 * pill beside it, because the two read as one bar. Submitting opens the agent
 * in the right-hand panel with this as its first message, so this is a launcher
 * rather than a second transcript, and it takes no attachments and shows no
 * history.
 */
function AgentPromptBar({ onAsk }: { onAsk: (message: string) => void }) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onAsk(trimmed);
      }}
      className="bg-card pointer-events-auto flex h-10 w-[min(26rem,42%)] items-center gap-2 rounded-full border py-1 pr-1 pl-3 shadow-sm"
    >
      <Zap className="text-muted-foreground size-4" />
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Ask the Flows Agent to change this flow…"
        aria-label="Ask the Flows Agent"
        className="placeholder:text-muted-foreground/70 min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
      <Hint label="Send to the Flows Agent" side="top">
        <button
          type="submit"
          aria-label="Send to the Flows Agent"
          disabled={!trimmed}
          className="press-control bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      </Hint>
    </form>
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
 * The Add control: a round `+` that opens the step picker above it.
 *
 * There are two of them, the bottom bar's and the one that appears on the last
 * node's hover, and they open the same menu on purpose: "what can I add here"
 * has one answer, and two lists drift.
 */
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
  label,
  direction = "horizontal",
  className,
  iconClassName,
}: {
  entries: FlowStepEntry[];
  onPick: (choice: FlowStepChoice) => void;
  label: string;
  /** Which edge of the card it hangs off: the one the next step is on. */
  direction?: CanvasDirection;
  className?: string;
  iconClassName?: string;
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
        <Hint label={label} side="top">
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={label}
                className={cn(
                  "press-control flex items-center justify-center rounded-full transition-[filter] hover:brightness-110",
                  className
                )}
              />
            }
          >
            <Plus className={iconClassName} />
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
  autoFocus = true,
}: {
  entries: FlowStepEntry[];
  onPick: (choice: FlowStepChoice) => void;
  /** False while the picker is mounted but clipped, so it never steals focus. */
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<FlowStepGroup | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!autoFocus) return;
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
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">
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
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{node.title}</h2>
        {node.status === "needs_setup" && (
          <Badge variant="outline" className="text-destructive border-destructive/30 rounded-full">
            Needs setup
          </Badge>
        )}
        {node.status === "preview_only" && (
          <Badge variant="outline" className="rounded-full border-amber-500/40 text-amber-600">
            Preview only
          </Badge>
        )}
        {/* Removing lives in the `⋯` now, beside the step's other options,
            rather than as a bare destructive button one pixel from Close. */}
        <NodeMenu entries={menu} side="bottom" align="end" />
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

      <Tabs defaultValue="configure" className="min-h-0 flex-1 gap-0">
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="configure">Configure</TabsTrigger>
          <TabsTrigger value="run">Run node</TabsTrigger>
        </TabsList>
        <TabsContent value="configure" className="overflow-y-auto p-4">
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
        <TabsContent value="run" className="overflow-y-auto p-4">
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
          A knowledge search runs inside a conversation. Open the Preview and ask the
          question this flow should answer; the Thinking panel shows the search.
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
