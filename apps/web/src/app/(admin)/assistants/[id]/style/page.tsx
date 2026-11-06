import { notFound } from "next/navigation";
import { StyleForm } from "@/components/assistant/style-form";
import { SectionHeading } from "@/components/ui/section-heading";
import { requireAssistantPageAccess } from "@/lib/authz";
import { can } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function StylePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { access } = await requireAssistantPageAccess(id);
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 @xl:px-8 @xl:py-10">
      <SectionHeading
        title="Style"
        description="Publish to apply changes."
      />
      <div className="mt-6">
        <StyleForm assistant={assistant} canEdit={can(access, "assistants:edit")} />
      </div>
    </div>
  );
}
