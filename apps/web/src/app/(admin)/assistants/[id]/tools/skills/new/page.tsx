import { notFound, redirect } from "next/navigation";
import { canEdit } from "@/lib/rbac";
import { SkillEditor } from "@/components/assistant/skill-editor";
import { requirePageMember } from "@/lib/authz";
import { getAssistantCached } from "../../../get-assistant";

/** A new Skill, created under Tools & Skills and attached to this Assistant. */
export default async function NewSkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role } = await requirePageMember();
  // The list offers "New skill" only to those who may edit; a typed URL gets the same answer.
  if (!canEdit(role)) redirect(`/assistants/${id}/tools`);
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  return <SkillEditor assistantId={id} skill={null} />;
}
