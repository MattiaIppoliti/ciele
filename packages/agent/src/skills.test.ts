import { describe, expect, it } from "vitest";
import type { SkillSnapshot } from "@agent-hub/core";
import { SKILL_INLINE_BUDGET_CHARS, planSkills, useSkillSpec } from "./skills";

const skill = (name: string, prompt: string): SkillSnapshot => ({
  id: `skill-${name}`,
  name,
  description: `When to use ${name}`,
  prompt,
  starter: "",
});

describe("planSkills", () => {
  it("keeps every skill inline while their bodies fit the budget", () => {
    const skills = [skill("refunds", "Offer a refund."), skill("tone", "Be warm.")];
    expect(planSkills(skills)).toEqual({ inline: skills, indexed: [] });
  });

  it("indexes every skill once their bodies outgrow the budget", () => {
    const long = "x".repeat(SKILL_INLINE_BUDGET_CHARS);
    const skills = [skill("refunds", "Offer a refund."), skill("handbook", long)];
    // All or nothing: half a playbook inline and half behind a tool would
    // leave the model unsure which kind it is looking at.
    expect(planSkills(skills)).toEqual({ inline: [], indexed: skills });
  });

  it("ignores skills with an empty body", () => {
    expect(planSkills([skill("empty", "   ")])).toEqual({ inline: [], indexed: [] });
  });
});

 it("loads a maximum-size playbook including its final instructions in one call", async () => {
  const body = "\u0001".repeat(49_987) + "REQUIRED TAIL";
  const spec = useSkillSpec([skill("long", body)]);
  const result = await spec.execute({name: "long"}, {} as never) as {instructions: string};
  expect(result.instructions).toBe(body);
  expect(JSON.stringify(result).length).toBeLessThan(spec.maxResultChars!);
 });
