"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Provider, Teammate, TeammateRoutine } from "@agent-hub/core";
import { Minimize2 } from "lucide-react";
import { Button, Hint } from "@agent-hub/ui";
import { Maximize2Icon } from "@/components/ui/icons/maximize-2";
import { AnimatedGlyph } from "@/components/ui/animated-icon";
import { useFullscreenGrow } from "@/components/chat/use-fullscreen-grow";
import { TeammateSettingsForm } from "@/components/teammates/teammate-settings-form";
import type { MemberOption } from "@/components/teammates/teammate-editors-picker";
import type { TeammateGovernanceState } from "@/components/teammates/teammate-grants-picker";
import type { CollectionOption } from "@/components/teammates/teammates-client";
import type { ScopeSource } from "@/lib/teammates/knowledge-scope";

/**
 * `/teammates/{id}/settings`: the configuration form, and the two things that
 * belong to the surface rather than to the form.
 *
 * Where the Member goes when they are done, which is back to the chat this
 * configures, and full screen. Full screen because this route now sits in a
 * pane beside the conversation rail (the Configure button in the chat comes
 * here instead of opening a drawer), and this form is long: the rail is what
 * you want while you are picking which Teammate to change, and in the way once
 * you are changing it.
 *
 * The same FLIP the chat card uses (`use-fullscreen-grow`), so the two
 * surfaces on this route expand identically rather than one growing and the
 * other snapping.
 */
export function TeammateSettingsPage({
  teammate,
  collections,
  sources,
  sourcesTruncated,
  members,
  governance,
  canGrant,
  projects,
  learnings,
  routines,
  unavailableProviders,
}: {
  teammate: Teammate;
  collections: CollectionOption[];
  sources: ScopeSource[];
  sourcesTruncated: boolean;
  members: MemberOption[];
  projects: { id: string; name: string }[];
  learnings: string;
  routines: TeammateRoutine[];
  unavailableProviders: Provider[];
  governance: TeammateGovernanceState;
  canGrant: boolean;
}) {
  const router = useRouter();
  const { fullscreen, setFullscreen, surfaceRef, animating, spacerRef } =
    useFullscreenGrow();

  // Escape leaves full screen, the same key the chat card answers.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, setFullscreen]);

  return (
    // The route owns its scroll: `(admin)/layout.tsx` gives `main`
    // `overflow-hidden` so each one decides how it scrolls, and this form is
    // longer than the viewport. Without it the bottom of the form, Save
    // included, was simply clipped away.
    //
    // While the grow animates, the surface is out of flow, so the spacer holds
    // its slot and is what the collapse measures back down to.
    <div className="flex h-full min-h-0 flex-col">
      {animating && <div ref={spacerRef} className="min-h-0 flex-1" />}
      <div
        ref={surfaceRef}
        className={
          fullscreen
            ? "bg-content fixed inset-0 z-50 overflow-y-auto"
            : "min-h-0 flex-1 overflow-y-auto"
        }
      >
        <div
          className={`mx-auto w-full ${fullscreen ? "max-w-5xl" : "max-w-3xl"}`}
        >
          <TeammateSettingsForm
            teammate={teammate}
            collections={collections}
            sources={sources}
            sourcesTruncated={sourcesTruncated}
            members={members}
            governance={governance}
            canGrant={canGrant}
            projects={projects}
            learnings={learnings}
            routines={routines}
            unavailableProviders={unavailableProviders}
            headerActions={
              <Hint
                label={fullscreen ? "Exit full screen" : "Open full screen"}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  aria-pressed={fullscreen}
                  aria-label={
                    fullscreen ? "Exit full screen" : "Open full screen"
                  }
                  onClick={() => setFullscreen(!fullscreen)}
                >
                  {fullscreen ? (
                    <Minimize2 className="size-4" />
                  ) : (
                    <AnimatedGlyph icon={Maximize2Icon} size={16} />
                  )}
                </Button>
              </Hint>
            }
            onDone={() => router.push(`/teammates/${teammate.id}`)}
          />
        </div>
      </div>
    </div>
  );
}
