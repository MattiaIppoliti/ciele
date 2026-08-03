import { notFound } from "next/navigation";
import { SetupPicker } from "@/components/shell/setup-picker";
import { SETUP_SECTIONS } from "@/components/shell/nav";
import { requirePageMember } from "@/lib/authz";

export const dynamic = "force-dynamic";

/**
 * Landing for a SETUP section reached without an assistant in scope
 * (Vercel's "Continue to Analytics — Choose a project to continue").
 */
export default async function SetupSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const config = SETUP_SECTIONS.find(
    (candidate) => candidate.slug === section && candidate.enabled
  );
  if (!config) notFound();

  const { db, reads } = await requirePageMember();
  const assistants = await reads.assistants();
  // "Active" = a Publication exists, i.e. the widget is live (same rule the
  // assistant Overview's Status row uses).
  const publications = await Promise.all(
    assistants.map((assistant) => db.getLatestPublication(assistant.id))
  );
  const Icon = config.icon;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20">
        <span className="bg-muted flex size-14 items-center justify-center rounded-xl border">
          <Icon className="text-muted-foreground size-6" />
        </span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">
          Continue to {config.label}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose an assistant to continue
        </p>
        <div className="mt-8 w-full">
          <SetupPicker
            slug={config.slug}
            assistants={assistants.map((assistant, index) => ({
              id: assistant.id,
              title: assistant.title,
              nickname: assistant.nickname,
              avatarUrl: assistant.avatarUrl,
              active: publications[index] !== null,
              updatedAt: assistant.updatedAt,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
