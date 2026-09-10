import type { ConnectorProvider, FlowAction, FlowTrigger } from "@agent-hub/core";
import {
  CONNECTOR_PROVIDERS,
  CONNECTOR_PROVIDER_LABELS,
  actionAllowedForTrigger,
  connectorAction,
  connectorRunsInternalOnly,
  isHttpTrigger,
  isProactiveTrigger,
} from "@agent-hub/core";

import {
  FLOW_ACTIONS,
  FLOW_ACTION_PICKER,
  HTTP_FLOW_ACTION_PICKER,
  FLOW_TRIGGER_LABELS,
  PROACTIVE_FLOW_ACTION_PICKER,
} from "@/lib/flow-actions";
import {
  flowConditionPicker,
  flowConditionsSavable,
  type FlowConditionKind,
  type FlowConditionKindMeta,
} from "@/lib/flow-conditions";
import { actionConfigured, triggerHasConditions, type FlowDraft } from "@/lib/flow-editor";

/**
 * The Flow Canvas (spec #836, ticket #837): the Flow Builder's second
 * rendering, drawn from the same `FlowDraft` the form edits.
 *
 * Everything here is a **projection**, decided on the map (#827): a node is a
 * view of a Trigger, of the Conditions step, or of one Response action, an edge
 * is the order those already have, and nothing is stored for the canvas on the
 * server. Positions are derived from the action order; a Member's manual
 * offsets live in the browser only. The canvas therefore cannot draw anything
 * the runtime would not run, and a draft saved from it is the draft the form
 * would have saved.
 *
 * Plain TS because vitest in this app ignores `.tsx`; the React Flow component
 * is a thin adapter over these functions.
 */

export type FlowCanvasNodeKind = "trigger" | "conditions" | "action";

/**
 * - `ok`: configured, nothing to do.
 * - `needs_setup`: required configuration missing (the badge on the node).
 * - `preview_only`: configured, but runs only on the operator surfaces, a Drive
 *   Connector (#840); Publish will refuse the Flow, and the badge says so.
 * - `empty`: an optional step with nothing in it (Conditions with none added).
 */
export type FlowCanvasNodeStatus = "ok" | "needs_setup" | "preview_only" | "empty";

export interface FlowCanvasNode {
  id: string;
  kind: FlowCanvasNodeKind;
  /** Set for `action` nodes only. */
  action?: FlowAction;
  title: string;
  subtitle: string;
  status: FlowCanvasNodeStatus;
  /** Position along the chain, 0 = the trigger. */
  index: number;
}

export interface FlowCanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface FlowCanvasProjection {
  nodes: FlowCanvasNode[];
  edges: FlowCanvasEdge[];
}

export const TRIGGER_NODE_ID = "trigger";
export const CONDITIONS_NODE_ID = "conditions";

export function actionNodeId(action: FlowAction): string {
  return `action:${action}`;
}

/** The action an `action:*` node id names, or null for the two step nodes. */
export function actionFromNodeId(id: string): FlowAction | null {
  return id.startsWith("action:") ? (id.slice("action:".length) as FlowAction) : null;
}

/**
 * The draft as a chain: Trigger → Conditions (message-triggered, non-default
 * flows only) → one node per Response action in `actions[]` order.
 */
export function projectFlowCanvas(
  draft: FlowDraft,
  options: { isDefaultFlow: boolean }
): FlowCanvasProjection {
  const nodes: FlowCanvasNode[] = [];
  const { trigger } = draft;
  const dwellSeconds = draft.dwell.minutes * 60 + draft.dwell.seconds;

  nodes.push({
    id: TRIGGER_NODE_ID,
    kind: "trigger",
    title: options.isDefaultFlow
      ? "Default behavior"
      : trigger
        ? FLOW_TRIGGER_LABELS[trigger]
        : "Start",
    subtitle: options.isDefaultFlow
      ? "Runs when no other flow matches"
      : trigger
        ? trigger === "time_on_page"
          ? `After ${draft.dwell.minutes}m ${draft.dwell.seconds}s on the page`
          : "Trigger"
        : "Choose what starts this flow",
    status: options.isDefaultFlow
      ? "ok"
      : trigger === null
        ? "needs_setup"
        : trigger === "time_on_page" && dwellSeconds <= 0
          ? "needs_setup"
          : "ok",
    index: 0,
  });

  // Only a message-triggered flow has a Conditions step (`triggerHasConditions`,
  // the same rule the palette, the trigger switch and the save consult), and
  // Default behavior has none either: the node would be a step the runtime
  // never evaluates.
  if (triggerHasConditions(trigger) && !options.isDefaultFlow) {
    const count = draft.conditions.length;
    nodes.push({
      id: CONDITIONS_NODE_ID,
      kind: "conditions",
      title: "Conditions",
      subtitle:
        count === 0
          ? "Optional, none added"
          : `${count} condition${count === 1 ? "" : "s"}, ${
              draft.conditionLogic === "all" ? "all must match" : "any may match"
            }`,
      status:
        count === 0
          ? "empty"
          : flowConditionsSavable(draft.conditions)
            ? "ok"
            : "needs_setup",
      index: nodes.length,
    });
  }

  for (const action of draft.actions) {
    const meta = FLOW_ACTIONS[action];
    const fits = trigger === null || actionAllowedForTrigger(action, trigger);
    // A Connector node is titled after what it does, not after its kind: the
    // catalogued action's title, and the provider as the subtitle.
    const catalogued =
      action === "connector" ? connectorAction(draft.settings.connector?.action) : null;
    const provider = draft.settings.connector?.provider ?? catalogued?.provider;
    nodes.push({
      id: actionNodeId(action),
      kind: "action",
      action,
      title: catalogued ? catalogued.title : meta.label,
      subtitle: !fits
        ? "This trigger cannot run it"
        : action === "connector" && provider
          ? CONNECTOR_PROVIDER_LABELS[provider]
          : meta.subtitle,
      status: !(fits && actionConfigured(action, draft.settings, draft.customMessage))
        ? "needs_setup"
        : action === "connector" && provider && connectorRunsInternalOnly(provider)
          ? "preview_only"
          : "ok",
      index: nodes.length,
    });
  }

  const edges: FlowCanvasEdge[] = [];
  for (let i = 1; i < nodes.length; i += 1) {
    const source = nodes[i - 1]!.id;
    const target = nodes[i]!.id;
    edges.push({ id: `${source}->${target}`, source, target });
  }
  return { nodes, edges };
}

export interface CanvasPoint {
  x: number;
  y: number;
}

/** Per-node manual displacement from the derived position, browser-only. */
export type CanvasOffsets = Record<string, CanvasPoint>;

export const CANVAS_NODE_WIDTH = 248;
export const CANVAS_NODE_GAP = 88;
/** A node card's drawn height, near enough for the vertical chain's spacing. */
export const CANVAS_NODE_HEIGHT = 76;
/**
 * The vertical chain's gap. Wide enough that a card carrying a "Needs setup"
 * badge, which is taller than `CANVAS_NODE_HEIGHT`, still leaves room for the
 * wire and the `+` that hangs under it.
 */
export const CANVAS_ROW_GAP = 72;
export const CANVAS_ORIGIN: CanvasPoint = { x: 48, y: 120 };

/**
 * Which way the chain runs.
 *
 * Not two layouts but one, read along a different axis: every derivation below
 * takes the direction and works on the main axis, so a step's place in the
 * chain means the same thing either way and only the pixels differ.
 */
export type CanvasDirection = "horizontal" | "vertical";

/** Derived chain position for a node at `index`, before any offset. */
export function derivedPosition(
  index: number,
  direction: CanvasDirection = "horizontal"
): CanvasPoint {
  return direction === "vertical"
    ? {
        x: CANVAS_ORIGIN.x,
        y: CANVAS_ORIGIN.y + index * (CANVAS_NODE_HEIGHT + CANVAS_ROW_GAP),
      }
    : {
        x: CANVAS_ORIGIN.x + index * (CANVAS_NODE_WIDTH + CANVAS_NODE_GAP),
        y: CANVAS_ORIGIN.y,
      };
}

/** The coordinate the chain advances along, and the card's size on it. */
function along(point: CanvasPoint, direction: CanvasDirection): number {
  return direction === "vertical" ? point.y : point.x;
}
function nodeExtent(direction: CanvasDirection): number {
  return direction === "vertical" ? CANVAS_NODE_HEIGHT : CANVAS_NODE_WIDTH;
}

/**
 * Where each node sits: the derived chain plus whatever the Member dragged.
 * Offsets for nodes no longer in the projection are ignored, not deleted, so a
 * removed-then-re-added action returns where it was left.
 */
export function layoutFlowCanvas(
  nodes: FlowCanvasNode[],
  offsets: CanvasOffsets,
  direction: CanvasDirection = "horizontal"
): Record<string, CanvasPoint> {
  const positions: Record<string, CanvasPoint> = {};
  for (const node of nodes) {
    const base = derivedPosition(node.index, direction);
    const offset = offsets[node.id];
    positions[node.id] = offset
      ? { x: base.x + offset.x, y: base.y + offset.y }
      : base;
  }
  return positions;
}

/** The offset that leaves a node exactly at `dragged`. */
export function offsetFor(
  node: FlowCanvasNode,
  dragged: CanvasPoint,
  direction: CanvasDirection = "horizontal"
): CanvasPoint {
  const base = derivedPosition(node.index, direction);
  return { x: dragged.x - base.x, y: dragged.y - base.y };
}

/**
 * The action index a point on the canvas lands at: the number of action nodes
 * (other than `except`) whose *drawn* centre lies before `at` along the chain's
 * own axis. Drawn, not derived, so a neighbour the Member nudged is judged
 * where they see it.
 */
export function dropIndexAt(
  nodes: FlowCanvasNode[],
  positions: Record<string, CanvasPoint>,
  at: number,
  except: FlowAction | null = null,
  direction: CanvasDirection = "horizontal"
): number {
  let index = 0;
  const half = nodeExtent(direction) / 2;
  for (const node of nodes) {
    if (node.kind !== "action" || node.action === except) continue;
    const position = positions[node.id] ?? derivedPosition(node.index, direction);
    if (along(position, direction) + half < at) index += 1;
  }
  return index;
}

/**
 * Dragging an action node *along* the chain reorders the actions (map #827):
 * the node's new index among action nodes is where its dropped centre falls
 * among the others' drawn centres. Returns null when the drop leaves the order
 * unchanged, so a small nudge is only an offset.
 */
export function reorderFromDrop(
  draft: Pick<FlowDraft, "actions">,
  nodes: FlowCanvasNode[],
  positions: Record<string, CanvasPoint>,
  action: FlowAction,
  dropped: CanvasPoint,
  direction: CanvasDirection = "horizontal"
): FlowAction[] | null {
  const targetIndex = dropIndexAt(
    nodes,
    positions,
    along(dropped, direction) + nodeExtent(direction) / 2,
    action,
    direction
  );
  const currentIndex = draft.actions.indexOf(action);
  if (currentIndex === -1 || currentIndex === targetIndex) return null;
  return moveAction(draft.actions, action, targetIndex);
}

/** `action` moved to `toIndex` among the remaining actions. */
export function moveAction(
  actions: FlowAction[],
  action: FlowAction,
  toIndex: number
): FlowAction[] {
  const without = actions.filter((candidate) => candidate !== action);
  const index = Math.max(0, Math.min(toIndex, without.length));
  return [...without.slice(0, index), action, ...without.slice(index)];
}

/** Insert an action at a chain position; appending is `index >= length`. */
export function insertActionAt(
  actions: FlowAction[],
  action: FlowAction,
  index: number
): FlowAction[] {
  if (actions.includes(action)) return actions;
  const at = Math.max(0, Math.min(index, actions.length));
  return [...actions.slice(0, at), action, ...actions.slice(at)];
}

export interface FlowCanvasPalette {
  /**
   * Response actions the trigger allows and the draft does not yet contain,
   * minus `connector`, which has its own palette category below.
   */
  actions: FlowAction[];
  /**
   * The Connector category (#839): one tile per provider. Empty when the
   * draft already has a Connector action (one per Flow, like every action) or
   * the trigger is proactive.
   */
  connectors: ConnectorProvider[];
  /** Condition kinds addable for the trigger; empty for proactive/default. */
  conditions: FlowConditionKindMeta[];
  /** Whether the Conditions step exists for this draft at all. */
  hasConditions: boolean;
}

/**
 * What the right-hand palette offers. Same catalogue as the form's "Add an
 * action" tiles, filtered by trigger through the one pairing rule the runtime
 * consults, so the canvas can never add an action the save would refuse.
 */
export function paletteForDraft(
  draft: Pick<FlowDraft, "trigger" | "actions">,
  options: { isDefaultFlow: boolean }
): FlowCanvasPalette {
  const { trigger } = draft;
  const proactive = trigger !== null && isProactiveTrigger(trigger);
  const inbound = trigger !== null && isHttpTrigger(trigger);
  const catalogue: FlowAction[] = proactive
    ? PROACTIVE_FLOW_ACTION_PICKER
    : inbound
      ? HTTP_FLOW_ACTION_PICKER
      : FLOW_ACTION_PICKER;
  const allowed = catalogue.filter(
    (action) =>
      !draft.actions.includes(action) &&
      (trigger === null || actionAllowedForTrigger(action, trigger))
  );
  // An inbound Flow is named by its URL, not chosen by a classifier, so there
  // is nothing for a condition to narrow: the caller already picked the Flow.
  // `triggerHasConditions` is where that rule lives; the projection above and
  // the save payload read the same one.
  const hasConditions = triggerHasConditions(trigger) && !options.isDefaultFlow;
  return {
    actions: allowed.filter((action) => action !== "connector"),
    connectors: allowed.includes("connector") ? [...CONNECTOR_PROVIDERS] : [],
    conditions: hasConditions ? flowConditionPicker(trigger) : [],
    hasConditions,
  };
}

export type FlowView = "form" | "canvas";

/**
 * Browser-storage key for the Member's preferred rendering. Keyed by Member so
 * two people sharing a browser profile do not share a preference.
 */
export function flowViewKey(memberId: string): string {
  return `flow-editor-view:${memberId}`;
}

/** A stored rendering preference, or null for anything this build does not render. */
export function parseFlowView(value: string | null): FlowView | null {
  return value === "form" || value === "canvas" ? value : null;
}

/**
 * Browser-storage key for one Member's manual offsets on one saved Flow, in one
 * direction. A new, unsaved Flow has no key: its offsets would outlive the
 * draft and reappear on the next unrelated new Flow.
 *
 * Keyed by direction because an offset is a nudge away from a *derived*
 * position, and the derivation is what the direction changes: a node dragged
 * 200px right in the horizontal chain has nothing to say about where it belongs
 * in the vertical one. Each direction therefore keeps its own arrangement, and
 * switching back finds the picture you left. Horizontal keeps the original
 * unsuffixed key, so nobody's existing layout is lost to this change.
 */
export function canvasOffsetsKey(
  memberId: string,
  assistantId: string,
  flowId: string | null,
  direction: CanvasDirection = "horizontal"
): string | null {
  if (!flowId) return null;
  const base = `flow-canvas-offsets:${memberId}:${assistantId}:${flowId}`;
  return direction === "vertical" ? `${base}:vertical` : base;
}

/** Browser-storage key for one Member's chain direction on one Assistant. */
export function canvasDirectionKey(memberId: string, assistantId: string): string {
  return `flow-canvas-direction:${memberId}:${assistantId}`;
}

/** A stored direction, or null for anything this build does not draw. */
export function parseCanvasDirection(value: string | null): CanvasDirection | null {
  return value === "horizontal" || value === "vertical" ? value : null;
}

/**
 * Offsets read back from storage. Anything that is not a finite x/y pair is
 * dropped rather than trusted, storage is writable by anything in the origin.
 */
export function parseCanvasOffsets(raw: string | null): CanvasOffsets {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const offsets: CanvasOffsets = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const { x, y } = value as { x?: unknown; y?: unknown };
    if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
      offsets[id] = { x, y };
    }
  }
  return offsets;
}

/**
 * One thing the step picker can add: the four kinds a Flow is built from. A
 * union rather than four callbacks because the picker renders one list and the
 * canvas answers one `onPick`; the alternative is a row that has to know which
 * of four handlers it belongs to.
 */
export type FlowStepChoice =
  | { kind: "trigger"; trigger: FlowTrigger }
  | { kind: "condition"; condition: FlowConditionKind }
  | { kind: "action"; action: FlowAction }
  | { kind: "connector"; provider: ConnectorProvider };

export const FLOW_STEP_GROUPS = ["Trigger", "Condition", "Action", "Connector"] as const;
export type FlowStepGroup = (typeof FLOW_STEP_GROUPS)[number];

export interface FlowStepEntry {
  /** Stable within one list; the React key and the drag payload's id. */
  id: string;
  group: FlowStepGroup;
  label: string;
  subtitle: string;
  choice: FlowStepChoice;
}

/**
 * Everything the canvas can add to *this* draft right now, as one flat list.
 *
 * Derived from `paletteForDraft`, which is the same filter the form's action
 * picker uses, so the canvas can never offer a step the save would refuse. The
 * Trigger group appears only while the Flow has none: replacing a trigger
 * discards configuration and is a confirmed decision the node panel owns, not
 * something to reach past a search box.
 */
export function flowStepEntries(
  draft: Pick<FlowDraft, "trigger" | "conditions">,
  palette: FlowCanvasPalette,
  options: { isDefaultFlow: boolean }
): FlowStepEntry[] {
  const entries: FlowStepEntry[] = [];

  if (!options.isDefaultFlow && draft.trigger === null) {
    for (const trigger of CANVAS_TRIGGERS) {
      entries.push({
        id: `trigger:${trigger}`,
        group: "Trigger",
        label: FLOW_TRIGGER_LABELS[trigger],
        subtitle: "Starts this flow",
        choice: { kind: "trigger", trigger },
      });
    }
  }

  for (const meta of palette.conditions) {
    entries.push({
      id: `condition:${meta.kind}`,
      group: "Condition",
      label: meta.label,
      subtitle: "Only continue when this matches",
      choice: { kind: "condition", condition: meta.kind },
    });
  }

  for (const action of palette.actions) {
    const meta = FLOW_ACTIONS[action];
    entries.push({
      id: `action:${action}`,
      group: "Action",
      label: meta.label,
      subtitle: meta.subtitle,
      choice: { kind: "action", action },
    });
  }

  for (const provider of palette.connectors) {
    const label = CONNECTOR_PROVIDER_LABELS[provider];
    entries.push({
      id: `connector:${provider}`,
      group: "Connector",
      label,
      subtitle: connectorRunsInternalOnly(provider)
        ? "Preview and Teammate chat only, under your own account"
        : `Run an action through a connected ${label}`,
      choice: { kind: "connector", provider },
    });
  }

  return entries;
}

/**
 * The picker's list, narrowed by its search box and its group chips. Matching
 * is on the label and the subtitle, so "slack" finds the connector and "email"
 * finds Send email; a group of `null` is "all".
 */
export function filterFlowStepEntries(
  entries: FlowStepEntry[],
  query: string,
  group: FlowStepGroup | null
): FlowStepEntry[] {
  const needle = query.trim().toLowerCase();
  const inGroup = entries.filter((entry) => group === null || entry.group === group);
  if (needle === "") return inGroup;
  const scored: { entry: FlowStepEntry; score: number }[] = [];
  for (const entry of inGroup) {
    const label = fuzzyScore(entry.label, needle);
    const subtitle = fuzzyScore(entry.subtitle, needle);
    if (label === null && subtitle === null) continue;
    // The label is what a Member is aiming at; a subtitle hit still counts, but
    // never above a step whose own name matches.
    scored.push({
      entry,
      score: Math.max(
        label === null ? Number.NEGATIVE_INFINITY : label * 2,
        subtitle === null ? Number.NEGATIVE_INFINITY : subtitle
      ),
    });
  }
  // Sort is stable, so equal scores keep the catalogue's order.
  scored.sort((a, b) => b.score - a.score);
  return scored.map((hit) => hit.entry);
}

/**
 * How well `needle` (already lower-cased) matches `text`, or null for no match.
 *
 * A subsequence match, not a substring one: "srchknw" finds "Search knowledge"
 * and "sndeml" finds "Send email", which is what someone typing quickly into a
 * step picker actually produces. Scoring is what keeps that from being noise,
 * a run of consecutive characters and a character starting a word are both
 * worth far more than a letter found somewhere in the middle, so the step whose
 * name you were typing sorts above the ones that merely contain the letters.
 */
export function fuzzyScore(text: string, needle: string): number | null {
  if (needle === "") return 0;
  const haystack = text.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const character of needle) {
    const at = haystack.indexOf(character, from);
    if (at === -1) return null;
    if (at === previous + 1) score += 8;
    else if (at === 0 || /[\s\-_/(]/.test(haystack[at - 1]!)) score += 6;
    else score += 1;
    previous = at;
    from = at + 1;
  }
  // A short name matched in full beats a long one that merely contains it.
  return score - haystack.length * 0.02;
}

/** The groups present in a list, in catalogue order, for rendering headings. */
export function flowStepGroupsOf(entries: FlowStepEntry[]): FlowStepGroup[] {
  return FLOW_STEP_GROUPS.filter((group) => entries.some((entry) => entry.group === group));
}

/** The triggers the Start node's panel offers, in the form's order. */
export const CANVAS_TRIGGERS: FlowTrigger[] = [
  "message",
  "page_load",
  "time_on_page",
  "chat_open",
  "http_request",
];
