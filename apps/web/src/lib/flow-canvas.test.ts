import { describe, expect, it } from "vitest";
import type { FlowDraft } from "./flow-editor";
import {
  CANVAS_NODE_GAP,
  CANVAS_NODE_WIDTH,
  CANVAS_ORIGIN,
  CONDITIONS_NODE_ID,
  TRIGGER_NODE_ID,
  actionFromNodeId,
  actionNodeId,
  CANVAS_NODE_HEIGHT,
  CANVAS_ROW_GAP,
  canvasDirectionKey,
  canvasOffsetsKey,
  derivedPosition,
  dropIndexAt,
  filterFlowStepEntries,
  fuzzyScore,
  flowStepEntries,
  flowStepGroupsOf,
  flowViewKey,
  insertActionAt,
  layoutFlowCanvas,
  moveAction,
  offsetFor,
  paletteForDraft,
  parseCanvasDirection,
  parseCanvasOffsets,
  parseFlowView,
  projectFlowCanvas,
  reorderFromDrop,
} from "./flow-canvas";

/**
 * The canvas is a projection of the draft (#827): these tests pin that a node
 * is a view of a Trigger / the Conditions step / one action, that the chain
 * order is the action order, and that nothing about layout is stored.
 */

const draft = (over: Partial<FlowDraft> = {}): FlowDraft => ({
  name: "Refunds",
  trigger: "message",
  dwell: { minutes: 0, seconds: 30 },
  httpMethods: ["POST"],
  conditionLogic: "any",
  conditions: [],
  actions: ["search_knowledge", "show_button"],
  settings: { show_button: { type: "external_link", url: "https://x.y", label: "Go" } },
  customMessage: "",
  ...over,
});

describe("projectFlowCanvas", () => {
  it("draws Trigger → Conditions → actions in action order, chained by edges", () => {
    const { nodes, edges } = projectFlowCanvas(draft(), { isDefaultFlow: false });
    expect(nodes.map((n) => n.id)).toEqual([
      TRIGGER_NODE_ID,
      CONDITIONS_NODE_ID,
      actionNodeId("search_knowledge"),
      actionNodeId("show_button"),
    ]);
    expect(nodes.map((n) => n.index)).toEqual([0, 1, 2, 3]);
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      [TRIGGER_NODE_ID, CONDITIONS_NODE_ID],
      [CONDITIONS_NODE_ID, actionNodeId("search_knowledge")],
      [actionNodeId("search_knowledge"), actionNodeId("show_button")],
    ]);
  });

  it("titles the Start node after the trigger and flags a missing one", () => {
    const withTrigger = projectFlowCanvas(draft(), { isDefaultFlow: false }).nodes[0]!;
    expect(withTrigger.title).toBe("User sends a message");
    expect(withTrigger.status).toBe("ok");

    const without = projectFlowCanvas(draft({ trigger: null }), { isDefaultFlow: false })
      .nodes[0]!;
    expect(without.title).toBe("Start");
    expect(without.status).toBe("needs_setup");
  });

  it("flags a zero dwell on Time on page as needing setup", () => {
    const node = projectFlowCanvas(
      draft({ trigger: "time_on_page", dwell: { minutes: 0, seconds: 0 } }),
      { isDefaultFlow: false }
    ).nodes[0]!;
    expect(node.status).toBe("needs_setup");
  });

  it("omits the Conditions node for proactive triggers and Default behavior", () => {
    const proactive = projectFlowCanvas(
      draft({ trigger: "chat_open", actions: ["notification"], settings: {} }),
      { isDefaultFlow: false }
    );
    expect(proactive.nodes.some((n) => n.id === CONDITIONS_NODE_ID)).toBe(false);

    const fallback = projectFlowCanvas(draft(), { isDefaultFlow: true });
    expect(fallback.nodes[0]!.title).toBe("Default behavior");
    expect(fallback.nodes.some((n) => n.id === CONDITIONS_NODE_ID)).toBe(false);
  });

  it("marks empty Conditions as empty, not as needing setup", () => {
    const node = projectFlowCanvas(draft(), { isDefaultFlow: false }).nodes[1]!;
    expect(node.status).toBe("empty");
    expect(node.subtitle).toMatch(/none added/);
  });

  it("marks an incomplete condition as needing setup and counts them", () => {
    const node = projectFlowCanvas(
      draft({
        conditionLogic: "all",
        conditions: [
          { id: "c1", kind: "url", operator: "contains", value: "" },
          { id: "c2", kind: "url", operator: "contains", value: "/courses" },
        ],
      }),
      { isDefaultFlow: false }
    ).nodes[1]!;
    expect(node.status).toBe("needs_setup");
    expect(node.subtitle).toBe("2 conditions, all must match");
  });

  it("uses the form's configured rule for action nodes", () => {
    const { nodes } = projectFlowCanvas(
      draft({ actions: ["api_request", "custom_message"], settings: {}, customMessage: "" }),
      { isDefaultFlow: false }
    );
    const api = nodes.find((n) => n.action === "api_request")!;
    const message = nodes.find((n) => n.action === "custom_message")!;
    expect(api.status).toBe("needs_setup");
    expect(message.status).toBe("needs_setup");

    const ok = projectFlowCanvas(
      draft({ actions: ["custom_message"], customMessage: "Hello" }),
      { isDefaultFlow: false }
    ).nodes.find((n) => n.action === "custom_message")!;
    expect(ok.status).toBe("ok");
  });

  it("flags an action the trigger cannot run", () => {
    const node = projectFlowCanvas(
      draft({ trigger: "chat_open", actions: ["search_knowledge"] }),
      { isDefaultFlow: false }
    ).nodes.find((n) => n.action === "search_knowledge")!;
    expect(node.status).toBe("needs_setup");
    expect(node.subtitle).toBe("This trigger cannot run it");
  });

  it("round-trips action node ids", () => {
    expect(actionFromNodeId(actionNodeId("iframe"))).toBe("iframe");
    expect(actionFromNodeId(TRIGGER_NODE_ID)).toBeNull();
  });
});

describe("layout", () => {
  it("derives positions from the chain index alone", () => {
    expect(derivedPosition(0)).toEqual(CANVAS_ORIGIN);
    expect(derivedPosition(2)).toEqual({
      x: CANVAS_ORIGIN.x + 2 * (CANVAS_NODE_WIDTH + CANVAS_NODE_GAP),
      y: CANVAS_ORIGIN.y,
    });
  });

  it("adds a Member's offsets and ignores offsets for absent nodes", () => {
    const { nodes } = projectFlowCanvas(draft(), { isDefaultFlow: false });
    const positions = layoutFlowCanvas(nodes, {
      [CONDITIONS_NODE_ID]: { x: 10, y: -20 },
      "action:iframe": { x: 999, y: 999 },
    });
    expect(positions[CONDITIONS_NODE_ID]).toEqual({
      x: derivedPosition(1).x + 10,
      y: derivedPosition(1).y - 20,
    });
    expect(positions[TRIGGER_NODE_ID]).toEqual(derivedPosition(0));
    expect(positions["action:iframe"]).toBeUndefined();
  });

  it("computes the offset that pins a node where it was dropped", () => {
    const { nodes } = projectFlowCanvas(draft(), { isDefaultFlow: false });
    const node = nodes[2]!;
    const dropped = { x: 700, y: 300 };
    const offset = offsetFor(node, dropped);
    expect(layoutFlowCanvas([node], { [node.id]: offset })[node.id]).toEqual(dropped);
  });
});

describe("reordering by drag", () => {
  const three = draft({
    actions: ["custom_message", "search_knowledge", "show_button"],
    customMessage: "Hi",
  });
  const { nodes } = projectFlowCanvas(three, { isDefaultFlow: false });
  const positions = layoutFlowCanvas(nodes, {});

  it("moves an action past its neighbour when dropped beyond it", () => {
    const target = derivedPosition(nodes.find((n) => n.action === "show_button")!.index);
    const next = reorderFromDrop(three, nodes, positions, "custom_message", {
      x: target.x + 10,
      y: target.y,
    });
    expect(next).toEqual(["search_knowledge", "show_button", "custom_message"]);
  });

  it("moves an action to the front when dropped before the first", () => {
    const first = derivedPosition(nodes.find((n) => n.action === "custom_message")!.index);
    const next = reorderFromDrop(three, nodes, positions, "show_button", {
      x: first.x - 20,
      y: first.y,
    });
    expect(next).toEqual(["show_button", "custom_message", "search_knowledge"]);
  });

  it("returns null for a nudge that keeps the order", () => {
    const own = derivedPosition(nodes.find((n) => n.action === "search_knowledge")!.index);
    expect(
      reorderFromDrop(three, nodes, positions, "search_knowledge", {
        x: own.x + 15,
        y: own.y + 40,
      })
    ).toBeNull();
  });

  it("judges neighbours where they are drawn, offsets included", () => {
    // The Member nudged Search knowledge far right; dropping Message just past
    // Search knowledge's *derived* slot no longer passes it visually.
    const nudged = layoutFlowCanvas(nodes, {
      [actionNodeId("search_knowledge")]: { x: 600, y: 0 },
    });
    const derivedSearch = derivedPosition(nodes.find((n) => n.action === "search_knowledge")!.index);
    expect(
      reorderFromDrop(three, nodes, nudged, "custom_message", {
        x: derivedSearch.x + 10,
        y: derivedSearch.y,
      })
    ).toBeNull();
  });

  it("dropIndexAt counts action nodes left of a point, for palette drops", () => {
    const first = derivedPosition(nodes.find((n) => n.action === "custom_message")!.index);
    const last = derivedPosition(nodes.find((n) => n.action === "show_button")!.index);
    expect(dropIndexAt(nodes, positions, first.x - 10)).toBe(0);
    expect(dropIndexAt(nodes, positions, first.x + CANVAS_NODE_WIDTH)).toBe(1);
    expect(dropIndexAt(nodes, positions, last.x + CANVAS_NODE_WIDTH)).toBe(3);
  });

  it("moveAction and insertActionAt clamp their index", () => {
    expect(moveAction(["a", "b", "c"] as never, "a" as never, 99)).toEqual(["b", "c", "a"]);
    expect(insertActionAt(["a", "b"] as never, "c" as never, 1)).toEqual(["a", "c", "b"]);
    expect(insertActionAt(["a", "b"] as never, "a" as never, 0)).toEqual(["a", "b"]);
  });
});

describe("paletteForDraft", () => {
  it("offers the message catalogue minus what the draft already has", () => {
    const palette = paletteForDraft(draft(), { isDefaultFlow: false });
    expect(palette.actions).not.toContain("search_knowledge");
    expect(palette.actions).not.toContain("show_button");
    expect(palette.actions).toContain("custom_message");
    expect(palette.actions).not.toContain("notification");
    // Connector is its own category: never among the action tiles.
    expect(palette.actions).not.toContain("connector");
    expect(palette.connectors).toEqual([
      "servicenow",
      "salesforce",
      "slack",
      "onedrive",
      "google_drive",
    ]);
    expect(palette.hasConditions).toBe(true);
    expect(palette.conditions.map((c) => c.kind)).toEqual([
      "conversation_context",
      "url",
      "schedule",
    ]);
  });

  it("offers only Notification for a proactive trigger, and no conditions", () => {
    const palette = paletteForDraft(draft({ trigger: "page_load", actions: [] }), {
      isDefaultFlow: false,
    });
    expect(palette.actions).toEqual(["notification"]);
    expect(palette.connectors).toEqual([]);
    expect(palette.conditions).toEqual([]);
    expect(palette.hasConditions).toBe(false);
  });

  it("draws no Conditions node and offers none for an inbound (On HTTP request) flow", () => {
    // The caller names the Flow by its URL (#843), so nothing routes to it and
    // the runtime never evaluates a condition: the projection and the palette
    // agree with the save, which stores none.
    const inbound = draft({
      trigger: "http_request",
      actions: ["respond"],
      conditions: [{ id: "c-url", kind: "url", operator: "contains", value: "x" }],
    });
    const { nodes } = projectFlowCanvas(inbound, { isDefaultFlow: false });
    expect(nodes.map((n) => n.id)).toEqual([TRIGGER_NODE_ID, actionNodeId("respond")]);
    const palette = paletteForDraft(inbound, { isDefaultFlow: false });
    expect(palette.hasConditions).toBe(false);
    expect(palette.conditions).toEqual([]);
    expect(palette.actions).toContain("api_request");
    expect(palette.actions).not.toContain("search_knowledge");
  });

  it("offers no Connector category once the draft has one, and titles its node by action", () => {
    const withConnector = draft({
      actions: ["connector"],
      settings: {
        connector: {
          provider: "slack",
          connectionId: "c1",
          action: "slack.message.post",
          params: { channel: "C1" },
        },
      },
    });
    expect(paletteForDraft(withConnector, { isDefaultFlow: false }).connectors).toEqual([]);
    const node = projectFlowCanvas(withConnector, { isDefaultFlow: false }).nodes.find(
      (n) => n.action === "connector"
    )!;
    expect(node.title).toBe("Post message");
    expect(node.subtitle).toBe("Slack");
    expect(node.status).toBe("ok");
    const bare = projectFlowCanvas(
      draft({ actions: ["connector"], settings: { connector: { provider: "servicenow" } } }),
      { isDefaultFlow: false }
    ).nodes.find((n) => n.action === "connector")!;
    expect(bare.title).toBe("Connector");
    expect(bare.subtitle).toBe("ServiceNow");
    expect(bare.status).toBe("needs_setup");
  });

  it("marks a configured Drive connector preview-only, never ok (#840)", () => {
    const node = projectFlowCanvas(
      draft({
        actions: ["connector"],
        settings: {
          connector: {
            provider: "onedrive",
            connectionId: "c1",
            action: "onedrive.file.create",
            params: { name: "a.txt", content: "hi" },
          },
        },
      }),
      { isDefaultFlow: false }
    ).nodes.find((n) => n.action === "connector")!;
    expect(node.status).toBe("preview_only");
  });

  it("offers nothing that needs a trigger before one is chosen, except actions", () => {
    const palette = paletteForDraft(draft({ trigger: null, actions: [] }), {
      isDefaultFlow: false,
    });
    expect(palette.conditions).toEqual([]);
    expect(palette.actions.length).toBeGreaterThan(0);
  });
});

describe("the step picker's catalogue", () => {
  const entriesFor = (over: Partial<FlowDraft> = {}, isDefaultFlow = false) => {
    const d = draft(over);
    return flowStepEntries(d, paletteForDraft(d, { isDefaultFlow }), { isDefaultFlow });
  };

  it("offers a trigger only while the Flow has none", () => {
    // Replacing a trigger discards configuration, so it is a confirmed
    // decision the node panel owns, not a row behind a search box.
    expect(entriesFor({ trigger: null }).some((e) => e.group === "Trigger")).toBe(true);
    expect(entriesFor({ trigger: "message" }).some((e) => e.group === "Trigger")).toBe(false);
  });

  it("never offers a step the draft already has", () => {
    const ids = entriesFor().map((entry) => entry.id);
    expect(ids).not.toContain("action:search_knowledge");
    expect(ids).not.toContain("action:show_button");
    expect(ids).toContain("action:custom_message");
  });

  it("carries the choice the canvas acts on, per kind", () => {
    const entries = entriesFor({ trigger: null, actions: [] });
    expect(entries.find((e) => e.id === "trigger:message")?.choice).toEqual({
      kind: "trigger",
      trigger: "message",
    });
    expect(entries.find((e) => e.id === "action:custom_message")?.choice).toEqual({
      kind: "action",
      action: "custom_message",
    });
    expect(entries.find((e) => e.group === "Connector")?.choice).toMatchObject({
      kind: "connector",
    });
  });

  it("offers only Notification and no conditions for a proactive trigger", () => {
    const entries = entriesFor({ trigger: "page_load", actions: [] });
    expect(entries.filter((e) => e.group === "Action").map((e) => e.id)).toEqual([
      "action:notification",
    ]);
    expect(entries.some((e) => e.group === "Condition")).toBe(false);
  });

  it("searches the label and the subtitle, and filters by group", () => {
    const entries = entriesFor({ trigger: null, actions: [] });
    // "knowledge" is in the label of one action and the subtitle of another.
    const hits = filterFlowStepEntries(entries, "knowledge", null);
    expect(hits[0]?.id).toBe("action:search_knowledge");
    expect(filterFlowStepEntries(entries, "", "Trigger").every((e) => e.group === "Trigger")).toBe(
      true
    );
    // Not a subsequence of anything in the catalogue.
    expect(filterFlowStepEntries(entries, "zzzz", null)).toEqual([]);
  });

  it("matches the letters someone actually types, and ranks the aimed-at step first", () => {
    const entries = entriesFor({ trigger: null, actions: [] });
    // A subsequence, not a substring: no row contains "srchknw".
    expect(filterFlowStepEntries(entries, "srchknw", null)[0]?.id).toBe(
      "action:search_knowledge"
    );
    expect(filterFlowStepEntries(entries, "sndeml", null)[0]?.id).toBe("action:send_email");
    // A whole word still wins over the rows that merely contain its letters.
    expect(filterFlowStepEntries(entries, "iframe", null)[0]?.id).toBe("action:iframe");
  });

  it("keeps the catalogue's order when nothing is typed", () => {
    const entries = entriesFor({ trigger: null, actions: [] });
    expect(filterFlowStepEntries(entries, "   ", null)).toEqual(entries);
  });

  it("lists present groups in catalogue order, so the headings never shuffle", () => {
    // A trigger and a condition never co-exist in the list: conditions are
    // offered per trigger, so before one is chosen there are none to offer.
    expect(flowStepGroupsOf(entriesFor({ trigger: null, actions: [] }))).toEqual([
      "Trigger",
      "Action",
      "Connector",
    ]);
    expect(flowStepGroupsOf(entriesFor({ trigger: "message", actions: [] }))).toEqual([
      "Condition",
      "Action",
      "Connector",
    ]);
  });

  it("has no trigger and no conditions for Default behavior", () => {
    const entries = entriesFor({ trigger: null, actions: [] }, true);
    expect(entries.some((e) => e.group === "Trigger")).toBe(false);
    expect(entries.some((e) => e.group === "Condition")).toBe(false);
    expect(entries.some((e) => e.group === "Action")).toBe(true);
  });
});

describe("fuzzy matching", () => {
  it("is a subsequence match, in order", () => {
    expect(fuzzyScore("Search knowledge", "sk")).not.toBeNull();
    expect(fuzzyScore("Search knowledge", "ks")).toBeNull();
    expect(fuzzyScore("Search knowledge", "searchx")).toBeNull();
  });

  it("scores a run above scattered letters, and a word start above the middle", () => {
    // A run of consecutive characters is the strongest signal there is.
    expect(fuzzyScore("Send email", "sen")!).toBeGreaterThan(
      fuzzyScore("Search knowledge", "sen")!
    );
    // A character that starts a word beats one found inside one.
    expect(fuzzyScore("Basic reply", "r")!).toBeGreaterThan(fuzzyScore("Iframe", "r")!);
  });

  it("matches everything against an empty needle", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });
});

describe("the vertical chain", () => {
  const nodes = projectFlowCanvas(
    draft({ actions: ["custom_message", "search_knowledge"] }),
    { isDefaultFlow: false }
  ).nodes;

  it("advances down the y axis instead of along x", () => {
    expect(derivedPosition(0, "vertical")).toEqual(CANVAS_ORIGIN);
    expect(derivedPosition(2, "vertical")).toEqual({
      x: CANVAS_ORIGIN.x,
      y: CANVAS_ORIGIN.y + 2 * (CANVAS_NODE_HEIGHT + CANVAS_ROW_GAP),
    });
  });

  it("round-trips a drag: the offset leaves the node exactly where it was dropped", () => {
    const node = nodes[2]!;
    const dropped = { x: 300, y: 900 };
    const offset = offsetFor(node, dropped, "vertical");
    expect(
      layoutFlowCanvas([node], { [node.id]: offset }, "vertical")[node.id]
    ).toEqual(dropped);
    // The same drop means something else in the other direction, which is why
    // each keeps its own offsets.
    expect(offsetFor(node, dropped, "horizontal")).not.toEqual(offset);
  });

  it("reorders on the y axis, so dragging a step below its neighbour moves it after it", () => {
    const positions = layoutFlowCanvas(nodes, {}, "vertical");
    const target = derivedPosition(
      nodes.find((n) => n.action === "search_knowledge")!.index,
      "vertical"
    );
    expect(
      reorderFromDrop(
        draft({ actions: ["custom_message", "search_knowledge"] }),
        nodes,
        positions,
        "custom_message",
        { x: CANVAS_ORIGIN.x, y: target.y + 10 },
        "vertical"
      )
    ).toEqual(["search_knowledge", "custom_message"]);
  });

  it("counts nodes above a point when a palette tile is dropped", () => {
    const positions = layoutFlowCanvas(nodes, {}, "vertical");
    const first = derivedPosition(
      nodes.find((n) => n.action === "custom_message")!.index,
      "vertical"
    );
    expect(dropIndexAt(nodes, positions, first.y - 10, null, "vertical")).toBe(0);
    expect(
      dropIndexAt(nodes, positions, first.y + CANVAS_NODE_HEIGHT, null, "vertical")
    ).toBe(1);
  });
});

describe("browser-stored preferences", () => {
  it("keys the view preference and the offsets by Member", () => {
    expect(flowViewKey("m1")).not.toBe(flowViewKey("m2"));
    expect(canvasOffsetsKey("m1", "a1", "f1")).not.toBe(canvasOffsetsKey("m2", "a1", "f1"));
    expect(canvasOffsetsKey("m1", "a1", "f1")).not.toBe(canvasOffsetsKey("m1", "a1", "f2"));
  });

  it("stores no offsets for an unsaved Flow", () => {
    expect(canvasOffsetsKey("m1", "a1", null)).toBeNull();
  });

  it("keeps each direction's arrangement apart, and leaves the horizontal key alone", () => {
    // An offset is a nudge away from a derived position, and the derivation is
    // what the direction changes; the old key stays the horizontal one so no
    // existing layout is lost to the switch shipping.
    expect(canvasOffsetsKey("m1", "a1", "f1")).toBe("flow-canvas-offsets:m1:a1:f1");
    expect(canvasOffsetsKey("m1", "a1", "f1", "horizontal")).toBe(
      canvasOffsetsKey("m1", "a1", "f1")
    );
    expect(canvasOffsetsKey("m1", "a1", "f1", "vertical")).not.toBe(
      canvasOffsetsKey("m1", "a1", "f1")
    );
    expect(canvasOffsetsKey("m1", "a1", null, "vertical")).toBeNull();
  });

  it("keys the direction per Member per Assistant, and accepts only the two", () => {
    expect(canvasDirectionKey("m1", "a1")).not.toBe(canvasDirectionKey("m2", "a1"));
    expect(canvasDirectionKey("m1", "a1")).not.toBe(canvasDirectionKey("m1", "a2"));
    expect(parseCanvasDirection("vertical")).toBe("vertical");
    expect(parseCanvasDirection("horizontal")).toBe("horizontal");
    expect(parseCanvasDirection("diagonal")).toBeNull();
    expect(parseCanvasDirection(null)).toBeNull();
  });

  it("accepts only the two renderings", () => {
    expect(parseFlowView("canvas")).toBe("canvas");
    expect(parseFlowView("form")).toBe("form");
    expect(parseFlowView("list")).toBeNull();
    expect(parseFlowView(null)).toBeNull();
  });

  it("keeps only finite x/y pairs from stored offsets", () => {
    expect(parseCanvasOffsets(null)).toEqual({});
    expect(parseCanvasOffsets("not json")).toEqual({});
    expect(parseCanvasOffsets("[1,2]")).toEqual({});
    expect(
      parseCanvasOffsets(
        JSON.stringify({
          a: { x: 1, y: 2 },
          b: { x: "1", y: 2 },
          c: { x: Infinity, y: 0 },
          d: null,
        })
      )
    ).toEqual({ a: { x: 1, y: 2 } });
  });
});
