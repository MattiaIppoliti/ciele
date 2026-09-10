import { describe, expect, it } from "vitest";
import type { FlowDraft } from "./flow-editor";
import {
  DRAFT_VERSION,
  draftDiffers,
  draftSavedLabel,
  flowDraftKey,
  parseStoredDraft,
  serializeDraft,
} from "./flow-draft-storage";

/**
 * The browser-kept draft (#837): a resumption, never an authority. These pin
 * that it is written only when it differs from the saved Flow, restored only
 * when it still does, and dropped rather than trusted when storage holds
 * anything this build does not recognise.
 */

const saved = (over: Partial<FlowDraft> = {}): FlowDraft => ({
  name: "Refunds",
  trigger: "message",
  dwell: { minutes: 0, seconds: 30 },
  httpMethods: ["POST"],
  conditionLogic: "any",
  conditions: [],
  actions: ["search_knowledge"],
  settings: {},
  customMessage: "",
  ...over,
});

const NOW = new Date("2026-09-09T12:00:00.000Z");

describe("where a draft lives", () => {
  it("keys by Member, Assistant and Flow, and calls an unsaved Flow 'new'", () => {
    // Scoped by Member on purpose: two Editors on one Flow must not inherit
    // each other's half-edits.
    expect(flowDraftKey("m1", "a1", "f1")).toBe("flow-draft:m1:a1:f1");
    expect(flowDraftKey("m2", "a1", "f1")).toBe("flow-draft:m2:a1:f1");
    expect(flowDraftKey("m1", "a1", null)).toBe("flow-draft:m1:a1:new");
  });
});

describe("writing a draft", () => {
  it("writes nothing while the draft still matches the saved Flow", () => {
    expect(serializeDraft(saved(), saved(), NOW)).toBeNull();
  });

  it("writes the draft and when it was written once it diverges", () => {
    const raw = serializeDraft(saved({ name: "Refunds v2" }), saved(), NOW);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.draft.name).toBe("Refunds v2");
    expect(parsed.savedAt).toBe(NOW.toISOString());
  });

  it("notices a change anywhere in the draft, not just the name", () => {
    expect(draftDiffers(saved({ actions: [] }), saved())).toBe(true);
    expect(draftDiffers(saved({ trigger: "page_load" }), saved())).toBe(true);
    expect(draftDiffers(saved({ customMessage: "hi" }), saved())).toBe(true);
    expect(draftDiffers(saved(), saved())).toBe(false);
  });
});

describe("restoring a draft", () => {
  const roundTrip = (draft: FlowDraft, against = saved()) =>
    parseStoredDraft(serializeDraft(draft, saved(), NOW), against);

  it("round-trips a diverged draft", () => {
    const restored = roundTrip(saved({ name: "Refunds v2" }));
    expect(restored?.draft.name).toBe("Refunds v2");
    expect(restored?.savedAt).toBe(NOW.toISOString());
  });

  it("declines a draft that no longer differs, so it announces nothing", () => {
    // Someone else saved the Flow into the state this draft was heading for.
    const raw = serializeDraft(saved({ name: "Refunds v2" }), saved(), NOW);
    expect(parseStoredDraft(raw, saved({ name: "Refunds v2" }))).toBeNull();
  });

  it("drops anything storage might hold that this build cannot use", () => {
    expect(parseStoredDraft(null, saved())).toBeNull();
    expect(parseStoredDraft("", saved())).toBeNull();
    expect(parseStoredDraft("not json", saved())).toBeNull();
    expect(parseStoredDraft("[]", saved())).toBeNull();
    expect(
      parseStoredDraft(JSON.stringify({ version: 99, savedAt: "x", draft: saved() }), saved())
    ).toBeNull();
    expect(
      parseStoredDraft(JSON.stringify({ version: DRAFT_VERSION, draft: saved() }), saved())
    ).toBeNull();
  });

  it("drops a version-1 draft, which predates httpMethods (#843)", () => {
    // A draft written before the field existed passes no shape check for it,
    // and restoring one let Save send `httpRequest: { methods: undefined }`.
    const { httpMethods: _dropped, ...v1 } = saved({ name: "Refunds v2" });
    void _dropped;
    expect(
      parseStoredDraft(JSON.stringify({ version: 1, savedAt: NOW.toISOString(), draft: v1 }), saved())
    ).toBeNull();
    expect(DRAFT_VERSION).toBe(2);
  });

  it("drops a payload whose draft is the wrong shape", () => {
    const wrong = (draft: unknown) =>
      parseStoredDraft(
        JSON.stringify({ version: DRAFT_VERSION, savedAt: NOW.toISOString(), draft }),
        saved()
      );
    expect(wrong(null)).toBeNull();
    expect(wrong({ ...saved(), name: 7 })).toBeNull();
    expect(wrong({ ...saved(), actions: "search_knowledge" })).toBeNull();
    expect(wrong({ ...saved(), dwell: null })).toBeNull();
    expect(wrong({ ...saved(), conditionLogic: "some" })).toBeNull();
    // The current-version draft still has to carry valid methods.
    const { httpMethods: _missing, ...withoutMethods } = saved({ name: "v2" });
    void _missing;
    expect(wrong(withoutMethods)).toBeNull();
    expect(wrong({ ...saved({ name: "v2" }), httpMethods: "POST" })).toBeNull();
    expect(wrong({ ...saved({ name: "v2" }), httpMethods: ["POST", "TRACE"] })).toBeNull();
    // And every allowed method round-trips.
    const allMethods = saved({ name: "v2", httpMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"] });
    expect(wrong(allMethods)?.draft.httpMethods).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  });
});

describe("how the header says it saved", () => {
  const at = (seconds: number) =>
    draftSavedLabel(new Date(NOW.getTime() - seconds * 1000).toISOString(), NOW);

  it("counts up through the units", () => {
    expect(at(2)).toBe("Draft saved just now");
    expect(at(120)).toBe("Draft saved 2 minutes ago");
    expect(at(60 * 60)).toBe("Draft saved 1 hour ago");
    expect(at(60 * 60 * 30)).toBe("Draft saved 1 day ago");
  });

  it("says something rather than NaN for a timestamp it cannot read", () => {
    expect(draftSavedLabel("whenever", NOW)).toBe("Draft saved");
  });
});
