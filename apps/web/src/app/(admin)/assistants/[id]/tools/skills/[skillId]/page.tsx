import { notFound, redirect } from "next/navigation";
import { canEdit } from "@/lib/rbac";
import { SkillEditor } from "@/components/assistant/skill-editor";
import { requirePageMember } from "@/lib/authz";
import { getAssistantCached } from "../../../get-assistant";

/**
 * One of the Organization's Skills, edited from an Assistant's Tools & Skills.
 * Skills are org-wide, so the Skill must belong to the Assistant's
 * Organization, not merely exist.
 */
export default async function SkillPage({
  params,
}: {
  params: Promise<{ id: string; skillId: string }>;
}) {
  const { id, skillId } = await params;
  const { db, role } = await requirePageMember();
  // The list offers Edit only to those who may edit; a typed URL gets the same answer.
  if (!canEdit(role)) redirect(`/assistants/${id}/tools`);
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  const skill = await db.table("skills").get(skillId);
  if (!skill || skill.organizationId !== assistant.organizationId) notFound();
  return <SkillEditor assistantId={id} skill={skill} />;
}
