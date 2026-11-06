import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/rbac";
import { SkillEditor } from "@/components/assistant/skill-editor";
import { requireAssistantPageAccess } from "@/lib/authz";
import { getAssistantCached } from "../../../get-assistant";

/** A new Skill, created under Tools & Skills and attached to this Assistant. */
export default async function NewSkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { access } = await requireAssistantPageAccess(id);
  // The list offers "New skill" only to those who may edit; a typed URL gets the same answer.
  if (!can(access, "skills:edit")) redirect(`/assistants/${id}/tools`);
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  return <SkillEditor assistantId={id} skill={null} />;
}
