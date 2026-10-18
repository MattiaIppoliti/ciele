import { describe, expect, it } from "vitest";
import { draftFromFlow, applyTriggerChange, flowDraftStatus, flowSavePayload, type FlowDraft } from "./flow-editor";
import { draftActionSteps, duplicateActionStep, moveActionStep, patchDraftActionSettings, patchDraftCustomMessage, removeActionStep, replaceDraftActions } from "./flow-action-editor";
import { projectFlowCanvas, dropIndexAt, layoutFlowCanvas } from "./flow-canvas";
import { parseStoredDraft, serializeDraft } from "./flow-draft-storage";
import { createDraftHistory, recordDraft, undoDraft, redoDraft } from "./flow-draft-history";

const original = (): FlowDraft => ({ ...draftFromFlow(null), name: "Two buttons", trigger: "message" as const,
  actions: ["show_button" as const], settings: { show_button: { type: "external_link" as const, label: "Admissions", url: "https://example.com/admissions" } } });

describe("independent copies of flow actions", () => {
  it("inserts an identical occurrence with a stable new ID after the original", () => {
    const before = original();
    const copied = duplicateActionStep(before, "action:show_button", "copy-button");
    const [first, second] = draftActionSteps(copied);
    expect(copied.actions).toEqual(["show_button", "show_button"]);
    expect(first?.id).toBe("action:show_button");
    expect(second).toEqual({ ...first, id: "copy-button", copiedFromId: "action:show_button" });
    expect(first?.settings).not.toBe(second?.settings);
    expect(second?.settings.show_button).not.toBe(first?.settings.show_button);
    expect(before.settings).not.toHaveProperty("steps");
  });

  it("changes only the selected copy, including the independent message body", () => {
    const copied = duplicateActionStep(original(), "action:show_button", "copy-button");
    const edited = patchDraftActionSettings(copied, "show_button", { label: "Financial aid", url: "https://example.com/aid" }, "copy-button");
    expect(draftActionSteps(edited).map(step => step.settings.show_button?.label)).toEqual(["Admissions", "Financial aid"]);
    const messages = { ...original(), actions: ["custom_message" as const], customMessage: "Welcome!" };
    const copiedMessage = duplicateActionStep(messages, "action:custom_message", "copy-message");
    const editedMessage = patchDraftCustomMessage(copiedMessage, "Goodbye!", "copy-message");
    expect(draftActionSteps(editedMessage).map(step => step.customMessage)).toEqual(["Welcome!", "Goodbye!"]);
  });

  it("deep copies nested configuration and keeps provenance when copying an unsaved copy", () => {
    const before = { ...original(), actions: ["api_request" as const], settings: { api_request: { url: "https://example.com/api", headers: [{ id: "scope", name: "X-Scope", value: "read" }] } } };
    const copied = duplicateActionStep(before, "action:api_request", "api-copy");
    const copiedTwice = duplicateActionStep(copied, "api-copy", "api-copy-2");
    const steps = draftActionSteps(copiedTwice);
    expect(steps[2]?.copiedFromId).toBe("action:api_request");
    steps[2]!.settings.api_request!.headers![0]!.value = "write";
    expect(steps[0]?.settings.api_request?.headers?.[0]?.value).toBe("read");
    expect(steps[1]?.settings.api_request?.headers?.[0]?.value).toBe("read");
  });

  it("reorders and removes one occurrence without losing a same-type neighbour", () => {
    let copied = duplicateActionStep(original(), "action:show_button", "copy-button");
    copied = patchDraftActionSettings(copied, "show_button", { label: "Copy" }, "copy-button");
    const moved = moveActionStep(copied, "copy-button", 0);
    expect(draftActionSteps(moved).map(step => step.id)).toEqual(["copy-button", "action:show_button"]);
    expect(moved.settings.show_button?.label).toBe("Copy");
    const removed = removeActionStep(moved, "copy-button");
    expect(draftActionSteps(removed).map(step => step.id)).toEqual(["action:show_button"]);
    expect(removed.settings.show_button?.label).toBe("Admissions");
  });

  it("saves and restores copied configurations, with a single undo/redo step", () => {
    const before = original();
    const copied = duplicateActionStep(before, "action:show_button", "copy-button");
    const history = recordDraft(createDraftHistory(before), copied);
    expect(undoDraft(history).present).toEqual(before);
    expect(redoDraft(undoDraft(history)).present).toEqual(copied);
    expect(flowSavePayload(copied, null).actionSettings.steps).toEqual(draftActionSteps(copied));
    const raw = serializeDraft(copied, before, new Date("2026-10-08T09:00:00Z"));
    expect(parseStoredDraft(raw, before)?.draft).toEqual(copied);
    expect(flowDraftStatus(copied, { isDefaultFlow: false, isEdit: true }).canSave).toBe(true);
    const invalidCopy = patchDraftActionSettings(copied, "show_button", { url: "" }, "copy-button");
    expect(flowDraftStatus(invalidCopy, { isDefaultFlow: false, isEdit: true }).canSave).toBe(false);
  });

  it("draws distinct nodes and excludes only the dragged occurrence", () => {
    const copied = duplicateActionStep(original(), "action:show_button", "copy-button");
    const projection = projectFlowCanvas(copied, { isDefaultFlow: false });
    const actions = projection.nodes.filter(node => node.kind === "action");
    expect(actions.map(node => node.id)).toEqual(["action:show_button", "copy-button"]);
    expect(actions.map(node => node.actionIndex)).toEqual([0, 1]);
    expect(projection.edges.at(-1)).toMatchObject({ source: "action:show_button", target: "copy-button" });
    expect(dropIndexAt(projection.nodes, layoutFlowCanvas(projection.nodes, {}), 10000, null, "horizontal", "copy-button")).toBe(1);
  });

  it("preserves copies through catalogue edits and removes incompatible steps on a trigger switch", () => {
    const copied = duplicateActionStep(original(), "action:show_button", "copy-button");
    const added = replaceDraftActions(copied, ["basic_reply", "show_button", "show_button"]);
    expect(draftActionSteps(added).slice(1).map(step => step.id)).toEqual(["action:show_button", "copy-button"]);
    const proactive = applyTriggerChange(added, "page_load");
    expect(proactive.actions).toEqual([]);
    expect(proactive.settings.steps).toEqual([]);
  });

  it("rejects stored copies with duplicate identities or mismatched action order", () => {
    const before = original();
    const copied = duplicateActionStep(before, "action:show_button", "copy-button");
    const steps = draftActionSteps(copied);
    const duplicateId = { ...copied, settings: { ...copied.settings, steps: [steps[0]!, { ...steps[1]!, id: steps[0]!.id }] } };
    expect(parseStoredDraft(serializeDraft(duplicateId, before, new Date()), before)).toBeNull();
    const mismatch = { ...copied, actions: ["show_button" as const] };
    expect(parseStoredDraft(serializeDraft(mismatch, before, new Date()), before)).toBeNull();
  });
});
