import { Suspense } from "react";
import { WidgetChat } from "@/components/widget/widget-chat";
import { getLatestPublicationCached } from "@/lib/widget-db";

/**
 * Static per Publication: the page uses no dynamic APIs, the Publication
 * arrives through the tagged cache (busted by Publish) and the ?c= Context
 * Hint is read client-side in WidgetChat, so the rendered shell is cached
 * and re-served until the next Publish instead of rendering per request.
 */
// Prerender nothing at build; render each assistant's shell on first visit
// and cache it (NextFaster's long-tail pattern, 1M pages, zero build cost).
export function generateStaticParams(): Array<{ assistantId: string }> {
  return [];
}

export default async function WidgetPage({
  params,
}: {
  params: Promise<{ assistantId: string }>;
}) {
  const { assistantId } = await params;
  const publication = await getLatestPublicationCached(assistantId);

  if (!publication) {
    return (
      <div className="flex h-screen items-center justify-center bg-background px-6 text-center">
        <p className="text-muted-foreground text-sm">
          This assistant hasn&apos;t been published yet.
        </p>
      </div>
    );
  }

  const { assistant, collections } = publication.config;
  // Only the Skills an admin gave an opening line to: the rest are prompt
  // layers with nothing to insert, and a `/` entry that inserts nothing is
  // worse than no entry.
  const skills = (publication.config.skills ?? [])
    .filter((skill) => (skill.starter ?? "").trim().length > 0)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      starter: skill.starter,
    }));

  return (
    // useSearchParams in WidgetChat needs a Suspense boundary on a static
    // page; the shell above it renders immediately.
    <Suspense fallback={null}>
      <WidgetChat
        assistantId={assistantId}
        nickname={assistant.nickname || assistant.title}
        avatarUrl={assistant.avatarUrl}
        welcomeMessage={assistant.welcomeMessage}
        aiDisclaimer={assistant.aiDisclaimer}
        suggestedQuestions={assistant.suggestedQuestions}
        quickReplies={assistant.quickReplies ?? []}
        brandColor={assistant.style?.brandColor ?? "#0a0a0a"}
        style={assistant.style ?? null}
        collections={collections}
        contactLabel={
          assistant.helpDeskSettings?.contactButtonLabel?.trim() ||
          "Contact support"
        }
        hideEscalation={assistant.helpDeskSettings?.hideEscalationButton ?? false}
        requireSignIn={assistant.requireSignIn ?? false}
        // Whether this Assistant opened the model picker at all, which the
        // snapshot knows on its own. The rows themselves depend on live
        // Provider Connections, so they are fetched by the client instead:
        // reading them here would make this page dynamic and cost every
        // Assistant an origin round-trip for a feature almost none use.
        modelChoice={(assistant.allowedModels ?? []).length > 0}
        skills={skills}
        attachmentsEnabled={assistant.attachmentsEnabled ?? false}
      />
    </Suspense>
  );
}
