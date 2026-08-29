import { notFound } from "next/navigation";
import { Plane } from "lucide-react";
import { PublishClient } from "@/components/assistant/publish-client";
import { SectionHero } from "@/components/settings/section-hero";
import { requirePageMember } from "@/lib/authz";
import { canPublish } from "@/lib/rbac";
import { getAssistantCached } from "../get-assistant";

export default async function PublishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { role, db } = await requirePageMember();
  const assistant = await getAssistantCached(id);
  if (!assistant) notFound();
  const publications = await db.listPublications(id);

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-10">
      <SectionHero
        icon={Plane}
        title="Publish"
        description="Publish creates an immutable snapshot, the live widget always serves the latest one. Edits stay in Preview until you publish again."
      />
      <PublishClient
        assistant={assistant}
        publications={publications.map((publication) => ({
          id: publication.id,
          version: publication.version,
          createdAt: publication.createdAt,
        }))}
        canPublish={canPublish(role)}
      />
    </div>
  );
}
