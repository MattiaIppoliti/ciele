import { UserRound } from "lucide-react";
import { personAvatarSeed } from "@/lib/avatar";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import { cn } from "@/lib/utils";

/**
 * A person's circular avatar: their uploaded picture, else one generated from
 * who they are.
 *
 * Three states, in order. An uploaded photo always wins. Without one, a figure
 * drawn from the person's id (or the address an invite went to), so a colleague
 * is recognisable in a list and two people with the same name do not share a
 * face. The generic silhouette survives for the one case with nobody to draw:
 * an open invite link, which names no person yet.
 */
export function UserAvatar({
  avatarUrl,
  userId,
  email,
  size = "size-9",
  className,
}: {
  avatarUrl?: string | null;
  /** Seeds the generated avatar; survives an email change. */
  userId?: string | null;
  /** The fallback seed, for a person known only by address. */
  email?: string | null;
  size?: string;
  className?: string;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className={cn(size, "shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  const seed = personAvatarSeed({ userId, email });
  if (seed) {
    return <GeneratedAvatar seed={seed} size={size} className={className} />;
  }

  return (
    <span
      className={cn(
        size,
        "bg-muted flex shrink-0 items-center justify-center rounded-full",
        className,
      )}
    >
      <UserRound className="text-foreground/70 size-[60%]" />
    </span>
  );
}
