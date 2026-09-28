import { notFound } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { GeneralForm } from "@/components/assistant/general-form";
import { SectionHeading } from "@/components/ui/section-heading";
import { requirePageMember } from "@/lib/authz";
import { modelSourcesByModel, providersWithoutCredential } from "@/lib/model-credentials";
import { modelCatalogWith } from "@/lib/platform-model-catalog";
import { getAssistantCached } from "../get-assistant";
import { listPlatformEvalModels } from "@/lib/platform";

export default async function GeneralPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db, organizationId } = await requirePageMember();
  const [assistant, connections, platformModels] = await Promise.all([
    getAssistantCached(id),
    db.listProviderConnections(organizationId),
    listPlatformEvalModels(),
  ]);
  if (!assistant) notFound();

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-10">
      <SectionHeading
        icon={SlidersHorizontal}
        title="General Settings"
        description="Manage your assistant's name, messaging, and other settings."
      />
      <GeneralForm
        assistant={assistant}
        unavailableProviders={providersWithoutCredential(connections)}
        platformModels={platformModels}
        modelSources={modelSourcesByModel(connections, modelCatalogWith(platformModels))}
      />
    </div>
  );
}
