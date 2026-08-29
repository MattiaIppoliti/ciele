import { notFound } from "next/navigation";
import { PenTool } from "lucide-react";
import { StyleForm } from "@/components/assistant/style-form";
import { SectionHero } from "@/components/settings/section-hero";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function StylePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-10">
      <SectionHero
        icon={PenTool}
        title="Style"
        description="Change the look and feel of your assistant. Changes take effect on the next publish."
      />
      <div className="mt-6">
        <StyleForm assistant={assistant} canEdit={canEdit(role)} />
      </div>
    </div>
  );
}
