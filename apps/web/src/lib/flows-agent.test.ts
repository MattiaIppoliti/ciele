import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@agent-hub/agent/client";
import { draftFromFlow, flowSavePayload } from "@/lib/flow-editor";
import {
  FLOWS_DRAFT_TOOL,
  FLOWS_PROPOSE_TOOL,
  draftPatchFromAgent,
  ensureReviewBeforeConnectorWrites,
  flowsAgentGrounding,
  flowsAgentPayload,
  mergeAgentSettings,
} from "./flows-agent";

const catalogue = {
  assistant: { id: "a1", title: "Campus" },
  flowId: null,
  draft: {
    ...draftFromFlow(null),
    name: "Refund policy",
    trigger: "message" as const,
    actions: ["custom_message" as const],
    customMessage: "We refund within 14 days.",
  },
  flows: [
    {
      id: "f0",
      name: "Default behavior",
      description: "",
      trigger: "message" as const,
      actions: [],
      enabled: true,
      isDefault: true,
      builtIn: true,
    },
    {
      id: "f2",
      name: "Library hours",
      description: "When the library opens",
      trigger: "message" as const,
      actions: ["search_knowledge" as const],
      enabled: false,
      isDefault: false,
      builtIn: false,
    },
  ],
  helpDesks: [{ id: "d1", name: "IT desk" }],
  faqs: [{ id: "q1", question: "How do I reset my password?" }],
  connections: [{ id: "c1", provider: "slack", name: "Campus Slack", status: "connected" }],
  collections: [{ id: "k1", name: "Student handbook" }],
  assistants: [{ id: "a2", title: "Admissions" }],
};

const toolEnd = (tool: string, result: Record<string, unknown>, ok = true): RuntimeEvent =>
  ({ type: "tool-end", callId: "c", tool, ok, result }) as RuntimeEvent;

describe("flowsAgentGrounding", () => {
  it("describes the open draft, the other flows and the catalogue, in that order", () => {
    const [open, flows, cat] = flowsAgentGrounding(catalogue);
    expect(open).toContain("new, not yet saved");
    expect(open).toContain("Name: Refund policy");
    expect(open).toContain("custom_message (Message)");
    expect(open).toContain("We refund within 14 days.");
    expect(flows).toContain("Default behavior [default]");
    expect(flows).toContain("Library hours");
    expect(flows).toContain("[disabled]");
    expect(cat).toContain("IT desk (id d1)");
    expect(cat).toContain("reset my password");
    expect(cat).toContain("Campus Slack [Slack, id c1, connected]");
    expect(cat).toContain("Student handbook");
    expect(cat).toContain("Admissions (id a2)");
  });

  it("leaves the open flow out of the other-flows list and names an empty catalogue", () => {
    const [, flows, cat] = flowsAgentGrounding({
      ...catalogue,
      flowId: "f2",
      flows: [catalogue.flows[1]],
      helpDesks: [],
      faqs: [],
      connections: [],
      collections: [],
      assistants: [],
    });
    expect(flows).toContain("None.");
    expect(cat).toContain("Help desks a Button of type help desk may open: none");
    expect(cat).toContain("Knowledge → Applications");
  });

  it("tells a proactive flow's agent what it cannot have", () => {
    const [open] = flowsAgentGrounding({
      ...catalogue,
      draft: { ...catalogue.draft, trigger: "chat_open", actions: [] },
    });
    expect(open).toContain("Proactive trigger");
    expect(open).not.toContain("Conditions (");
  });

  it("tells an inbound flow's agent it has no conditions, and which methods it answers", () => {
    const [open] = flowsAgentGrounding({
      ...catalogue,
      draft: {
        ...catalogue.draft,
        trigger: "http_request",
        httpMethods: ["POST", "PUT"],
        actions: ["respond"],
      },
    });
    expect(open).toContain("Inbound HTTP trigger: no conditions");
    expect(open).toContain("Methods: POST, PUT");
    expect(open).not.toContain("Conditions (");
  });
});

describe("flowsAgentPayload", () => {
  it("reads a draft hand-back off a successful flows_draft tool-end", () => {
    const payload = flowsAgentPayload(
      toolEnd(FLOWS_DRAFT_TOOL, {
        operation: "flows.draft",
        payload: { applied: "draft", summary: "Added Slack", patch: { actions: ["connector"] } },
      })
    );
    expect(payload).toEqual({
      kind: "draft",
      summary: "Added Slack",
      patch: { actions: ["connector"] },
    });
  });

  it("reads a proposal off flows_propose", () => {
    const payload = flowsAgentPayload(
      toolEnd(FLOWS_PROPOSE_TOOL, {
        payload: { proposal: { name: "Refunds" }, rationale: "own intent", assistantId: "a1" },
      })
    );
    expect(payload).toEqual({ kind: "proposal", rationale: "own intent", flow: { name: "Refunds" } });
  });

  it("ignores refused calls, other tools and other events", () => {
    expect(
      flowsAgentPayload(
        toolEnd(FLOWS_DRAFT_TOOL, { payload: { applied: "draft", patch: {} } }, false)
      )
    ).toBeNull();
    expect(flowsAgentPayload(toolEnd("flows_list", { payload: { applied: "draft", patch: {} } }))).toBeNull();
    expect(flowsAgentPayload({ type: "flow", flowName: "x" } as RuntimeEvent)).toBeNull();
  });
});

describe("draftPatchFromAgent", () => {
  it("maps every patch field onto its draft field and nothing else", () => {
    expect(
      draftPatchFromAgent({
        name: "N",
        description: "ignored",
        trigger: "time_on_page",
        triggerSettings: { timeOnPage: { minutes: 1, seconds: 30 } },
        conditionLogic: "all",
        conditions: [],
        actions: ["notification"],
        actionSettings: { notification: { title: "Hi" } } as never,
        customMessage: "m",
      })
    ).toEqual({
      name: "N",
      trigger: "time_on_page",
      dwell: { minutes: 1, seconds: 30 },
      // Trigger settings unpack into both trigger-scoped fields: a dwell-only
      // patch leaves the methods at the default, as `draftFromFlow` would.
      httpMethods: ["POST"],
      conditionLogic: "all",
      conditions: [],
      actions: ["notification"],
      settings: { notification: { title: "Hi" } },
      customMessage: "m",
    });
  });

  it("carries the HTTP methods of an inbound patch into the draft, the inverse of the save", () => {
    const patch = draftPatchFromAgent({
      trigger: "http_request",
      triggerSettings: { httpRequest: { methods: ["GET", "POST"] } },
    });
    expect(patch.httpMethods).toEqual(["GET", "POST"]);
    // Round trip: what the agent drafted is what Save would send.
    const saved = flowSavePayload({ ...draftFromFlow(null), ...patch }, null);
    expect(saved.triggerSettings).toEqual({ httpRequest: { methods: ["GET", "POST"] } });
  });

  it("a partial patch touches only what it names", () => {
    expect(draftPatchFromAgent({ customMessage: "x" })).toEqual({ customMessage: "x" });
  });
});

describe("ensureReviewBeforeConnectorWrites", () => {
  const current = { actions: [] as never[], settings: {} };

  it("inserts a Human review before a Connector write the chain has no gate for", () => {
    expect(
      ensureReviewBeforeConnectorWrites(
        {
          actions: ["custom_message", "connector"],
          actionSettings: { connector: { action: "slack.message.post" } } as never,
        },
        current
      ).actions
    ).toEqual(["custom_message", "human_review", "connector"]);
  });

  it("moves a gate that sits after the write to before it", () => {
    expect(
      ensureReviewBeforeConnectorWrites(
        {
          actions: ["connector", "human_review"],
          actionSettings: { connector: { action: "servicenow.record.create" } } as never,
        },
        current
      ).actions
    ).toEqual(["human_review", "connector"]);
  });

  it("leaves reads, gated chains and patches without actions alone", () => {
    expect(
      ensureReviewBeforeConnectorWrites(
        { actions: ["connector"], actionSettings: { connector: { action: "servicenow.record.list" } } as never },
        current
      ).actions
    ).toEqual(["connector"]);
    expect(
      ensureReviewBeforeConnectorWrites(
        { actions: ["human_review", "connector"], actionSettings: { connector: { action: "slack.message.post" } } as never },
        current
      ).actions
    ).toEqual(["human_review", "connector"]);
    expect(ensureReviewBeforeConnectorWrites({ name: "x" }, current)).toEqual({ name: "x" });
  });

  it("gates a settings-only patch that re-points an existing Connector at a write", () => {
    expect(
      ensureReviewBeforeConnectorWrites(
        { actionSettings: { connector: { action: "slack.message.post" } } as never },
        { actions: ["custom_message", "connector"] as never, settings: {} }
      ).actions
    ).toEqual(["custom_message", "human_review", "connector"]);
  });

  it("reads the write/read effect from the current draft when the patch keeps the settings", () => {
    expect(
      ensureReviewBeforeConnectorWrites(
        { actions: ["connector"] },
        { actions: ["connector"], settings: { connector: { action: "slack.message.post" } } as never }
      ).actions
    ).toEqual(["human_review", "connector"]);
  });
});

describe("mergeAgentSettings", () => {
  const current = {
    api_request: { url: "https://x" },
    connector: { provider: "slack" },
  } as never;

  it("keeps settings the patch is silent about", () => {
    expect(
      mergeAgentSettings(current, { actionSettings: { connector: { action: "post" } } as never })
    ).toEqual({
      api_request: { url: "https://x" },
      connector: { provider: "slack", action: "post" },
    });
  });

  it("drops settings for actions a rewritten chain no longer has", () => {
    expect(
      mergeAgentSettings(current, {
        actions: ["connector"],
        actionSettings: { connector: { action: "post" } } as never,
      })
    ).toEqual({ connector: { provider: "slack", action: "post" } });
  });

  it("returns undefined when the patch carries no settings", () => {
    expect(mergeAgentSettings(current, { name: "x" })).toBeUndefined();
  });
});
