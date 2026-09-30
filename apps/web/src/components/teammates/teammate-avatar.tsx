import type { Teammate } from "@agent-hub/core";
import { teammateAvatarSeed } from "@/lib/avatar";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import { CieleAiLogo } from "@/components/teammates/ciele-ai-logo";

/**
 * The Teammate's face, generated from its seed, so it looks the same on the
 * roster, in the chat header and in a transcript without anyone uploading an
 * image (#768).
 *
 * Was two initials over a hashed hue. Initials collide the moment an
 * organization has a Nora and a Nico, and a coloured circle with letters in it
 * is not something you recognise in a list; a drawn figure is.
 */
export function TeammateAvatar({
  teammate,
  className = "size-8",
}: {
  teammate: Pick<Teammate, "id" | "name" | "avatarSeed"> &
    Partial<Pick<Teammate, "systemKind">>;
  className?: string;
}) {
  // Ciele AI is the one face that is drawn, not generated.
  if (teammate.systemKind === "ciele_ai") return <CieleAiLogo className={className} />;
  return <GeneratedAvatar seed={teammateAvatarSeed(teammate)} size={className} />;
}
