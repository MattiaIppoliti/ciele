import { notFound } from "next/navigation";
import { GeneralForm } from "@/components/assistant/general-form";
import { requirePageMember } from "@/lib/authz";
import { getAssistantCached } from "../get-assistant";

export default async function GeneralPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
      <h1 className="text-2xl font-semibold">General Settings</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Manage your assistant&apos;s name, messaging, and other settings.
      </p>
      <GeneralForm assistant={assistant} />
    </div>
  );
}
