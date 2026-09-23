import { notFound } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { GeneralForm } from "@/components/assistant/general-form";
import { SectionHero } from "@/components/settings/section-hero";
import { requirePageMember } from "@/lib/authz";
import { providersWithoutCredential } from "@/lib/model-credentials";
import { getAssistantCached } from "../get-assistant";

export default async function GeneralPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db, organizationId } = await requirePageMember();
  const [assistant, connections] = await Promise.all([
    getAssistantCached(id),
    db.listProviderConnections(organizationId),
  ]);
  if (!assistant) notFound();

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-10">
      <SectionHero
        icon={SlidersHorizontal}
        title="General Settings"
        description="Manage your assistant's name, messaging, and other settings."
      />
      <GeneralForm
        assistant={assistant}
        unavailableProviders={providersWithoutCredential(connections)}
      />
    </div>
  );
}
