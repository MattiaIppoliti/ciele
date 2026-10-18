import { describe, expect, it } from "vitest";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import { createFlowOp, draftFlowOp, getFlowOp, updateFlowOp } from "./flows";
import type { OperationContext } from "./operation";

function fixture() {
  const db = getMockDb();
  const ctx: OperationContext = { organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "editor", db };
  return { db, ctx };
}

describe("independent Flow action instances", () => {
  it("saves repeated actions and rejects hidden or misordered instances", async () => {
    const { db, ctx } = fixture();
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Copies" });
    const flow = await createFlowOp.run(ctx, { assistantId: assistant.id, input: {
      name: "Links", actions: ["show_button", "show_button"], actionSettings: { steps: [
        { id: "one", action: "show_button", settings: { show_button: { label: "One" } } },
        { id: "two", action: "show_button", settings: { show_button: { label: "Two" } } },
      ] },
    } });
    expect((await db.getFlow(flow.id))?.actionSettings.steps?.map((step) => step.settings.show_button?.label)).toEqual(["One", "Two"]);
    await expect(updateFlowOp.run(ctx, { id: flow.id, patch: { actions: ["show_button"] } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(updateFlowOp.run(ctx, { id: flow.id, patch: { actionSettings: { steps: [
      { id: "one", action: "custom_message", settings: {} },
      { id: "two", action: "show_button", settings: {} },
    ] } } })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("keeps instance settings aligned when an agent adds human review", async () => {
    const { ctx } = fixture();
    const result = await draftFlowOp.run(ctx, { summary: "Post to Slack", patch: {
      actions: ["connector", "connector"], actionSettings: { steps: [
        { id: "read", action: "connector", settings: { connector: { action: "slack.channel.list" } } },
        { id: "write", action: "connector", settings: { connector: { action: "slack.message.post" } } },
      ] },
    } });
    expect(result.patch.actions).toEqual(["connector", "human_review", "connector"]);
    expect(result.patch.actionSettings?.steps?.map((step) => step.action)).toEqual(result.patch.actions);
    expect(result.patch.actionSettings?.steps?.[2].id).toBe("write");
  });

  it("copies masked credentials from the same Flow and removes copy provenance", async () => {
    const { db, ctx } = fixture();
    const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Credentials" });
    const flow = await createFlowOp.run(ctx, { assistantId: assistant.id, input: {
      name: "Two requests", actions: ["api_request"], actionSettings: { steps: [
        { id: "original", action: "api_request", settings: { api_request: {
          url: "https://example.com/one", auth: { type: "bearer", token: "private-token" },
        } } },
      ] },
    } });
    const source = (await getFlowOp.run(ctx, { id: flow.id })).actionSettings.steps?.[0];
    if (!source) throw new Error("Source instance missing");
    expect(source.settings.api_request?.auth).toEqual({ type: "bearer", hasToken: true });
    await updateFlowOp.run(ctx, { id: flow.id, patch: {
      actions: ["api_request", "api_request"], actionSettings: { steps: [
        source, { ...source, id: "copy", copiedFromId: source.id, settings: {
          api_request: { ...source.settings.api_request, url: "https://example.com/two" },
        } },
      ] },
    } });
    const persisted = (await db.getFlow(flow.id))?.actionSettings.steps;
    expect(persisted?.map((step) => step.settings.api_request?.auth)).toEqual([
      { type: "bearer", token: "private-token" }, { type: "bearer", token: "private-token" },
    ]);
    expect(persisted?.[1]).not.toHaveProperty("copiedFromId");
    expect((await getFlowOp.run(ctx, { id: flow.id })).actionSettings.steps?.[1].settings.api_request?.auth)
      .toEqual({ type: "bearer", hasToken: true });
  });
});
