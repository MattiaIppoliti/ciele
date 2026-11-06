import { z } from "zod";
import type { SkillSnapshot } from "@agent-hub/core";
import type { RuntimeToolSpec } from "./tools";

/**
 * How an Assistant's attached Skills reach the model: whole in the system
 * prompt, or as an index the model loads from on demand.
 *
 * Whole is right while they are short: the model sees every playbook without
 * spending a call. Past {@link SKILL_INLINE_BUDGET_CHARS} every gather step was
 * resending pages of playbooks a conversation mostly never uses (an Assistant
 * may attach 100), so the prompt carries one line per Skill, its name and its
 * description, and `useSkill` returns the body when the model needs it.
 *
 * All or nothing, on purpose: half the playbooks inline and half behind a
 * tool leaves the model unsure which kind it is looking at.
 */
export const SKILL_INLINE_BUDGET_CHARS = 4_000;

export function planSkills(skills: readonly SkillSnapshot[]): {
  inline: SkillSnapshot[];
  indexed: SkillSnapshot[];
} {
  const live = skills.filter((skill) => skill.prompt.trim());
  const total = live.reduce((sum, skill) => sum + skill.prompt.trim().length, 0);
  return total <= SKILL_INLINE_BUDGET_CHARS
    ? { inline: live, indexed: [] }
    : { inline: [], indexed: live };
}

/** The system-prompt lines for an indexed Skill set. */
export function skillIndexSection(indexed: readonly SkillSnapshot[]): string[] {
  return [
    "# Attached skills (organization-authored playbooks)",
    "Each line names a playbook and when it applies. When one applies to this conversation, call useSkill with its exact name and follow what it returns.",
    ...indexed.map((skill) => `- ${skill.name}: ${skill.description.trim() || "no description"}`),
  ];
}

/** The tool that returns an indexed Skill's body; a read, so it runs beside its step's other reads. */
export function useSkillSpec(indexed: readonly SkillSnapshot[]): RuntimeToolSpec {
  const byName = new Map(indexed.map((skill) => [skill.name.trim().toLowerCase(), skill]));
  return {
    name: "useSkill",
    execution: "parallel-read",
    // The authoring boundary caps a prompt at 50k characters; JSON escaping
    // can expand each character sixfold. Load it in one gather step.
    maxResultChars: 310_000,
    description:
      "Load one of the organization's playbooks by its exact name, from the list in your instructions, and follow it.",
    inputSchema: z.object({
      name: z.string().describe("The playbook's name, exactly as listed."),
    }),
    label: (input) => `Reading the “${String(input.name ?? "")}” playbook`,
    summarize: (output) => (output as { name?: string })?.name,
    async execute(input) {
      const skill = byName.get(String(input.name ?? "").trim().toLowerCase());
      if (!skill) {
        return {
          error: `No playbook with that name. The playbooks are: ${indexed
            .map((s) => s.name)
            .join(", ")}.`,
        };
      }
      return { name: skill.name, instructions: skill.prompt.trim() };
    },
  };
}
