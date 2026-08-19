import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A signed-in user's circular avatar. Falls back to a generic, gender-
 * neutral silhouette (the same UserRound-in-a-muted-circle idiom already
 * used for members without a picture) rather than initials or an emoji,
 * every new user starts with this until they upload a real photo.
 */
export function UserAvatar({
  avatarUrl,
  size = "size-9",
  className,
}: {
  avatarUrl?: string | null;
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
