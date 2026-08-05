import { notFound } from "next/navigation";
import { StyleForm } from "@/components/assistant/style-form";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function StylePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <h1 className="text-2xl font-semibold">Style</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        The widget&apos;s appearance, brand color and launcher placement.
        Changes take effect on the next publish.
      </p>
      <div className="mt-6">
        <StyleForm assistant={assistant} canEdit={canEdit(role)} />
      </div>
    </div>
  );
}
