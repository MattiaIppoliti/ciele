import type { Skill } from "@agent-hub/core";

/** What the composer's `/` menu needs of a Skill. */
export type StarterSkill = Pick<Skill, "id" | "name" | "description" | "starter">;

/**
 * The Skills `/` offers: only those an admin gave an opening line to. The rest
 * are prompt layers with nothing to insert, and a `/` entry that inserts
 * nothing is worse than no entry.
 */
export function starterSkills(skills: readonly StarterSkill[]): StarterSkill[] {
  return skills
    .filter((skill) => (skill.starter ?? "").trim().length > 0)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      starter: skill.starter,
    }));
}
