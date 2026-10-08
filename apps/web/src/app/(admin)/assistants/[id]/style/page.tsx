import { notFound } from "next/navigation";
import { PenTool } from "lucide-react";
import { StyleForm } from "@/components/assistant/style-form";
import { SectionHeading } from "@/components/ui/section-heading";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function StylePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 @xl:px-8 @xl:py-10">
      <SectionHeading
        icon={PenTool}
        title="Style"
        description="Publish to apply changes."
      />
      <div className="mt-6">
        <StyleForm assistant={assistant} canEdit={canEdit(role)} />
      </div>
    </div>
  );
}
