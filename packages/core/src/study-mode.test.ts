import { describe, expect, it } from "vitest";
import { studyModeFlow, studyRequestFormat } from "./study-mode";

describe("settings-owned study flow", () => {
  it("exists only while Study Mode is enabled and a format is available", () => {
    const settings = { enabled: true, formats: ["true_false" as const], instructions: "" };
    const enabled = studyModeFlow({ id: "a", tools: { studyMode: settings } });
    expect(enabled).toMatchObject({ enabled: true, builtIn: true, actions: ["search_knowledge"], name: "Study Mode" });
    expect(studyModeFlow({ id: "a", tools: {} })).toBeNull();
    expect(studyModeFlow({ id: "a", tools: { studyMode: { ...settings, enabled: false } } })).toBeNull();
    expect(studyModeFlow({ id: "a", tools: { studyMode: { ...settings, formats: [] } } })).toBeNull();
  });
  it("recognizes only an explicit leading composer command", () => {
    expect(studyRequestFormat(" @TRUEFALSE chi è Carlo Magno?")).toBe("true_false");
    expect(studyRequestFormat("@study history")).toBe("auto");
    expect(studyRequestFormat("@quiz history")).toBe("multiple_choice");
    expect(studyRequestFormat("What does @quiz mean?")).toBeNull();
    expect(studyRequestFormat("@quizmaster")).toBeNull();
  });
});
