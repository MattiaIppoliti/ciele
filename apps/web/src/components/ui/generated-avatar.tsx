import { generatedAvatar } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/**
 * The avatar drawn from a seed, for anyone without an uploaded picture.
 *
 * Server-renderable on purpose: `blobatar` returns SVG markup, so this needs no
 * client boundary, no effect and no hydration. That is why it uses the string
 * API rather than the library's React adapter, which memoizes for animation this
 * app does not use and would make every avatar a client component.
 *
 * `dangerouslySetInnerHTML` with markup from a pure local function over a seed
 * we chose: no user input reaches it, and nothing is fetched.
 */
export function GeneratedAvatar({
  seed,
  size = "size-9",
  className,
}: {
  seed: string;
  /** A Tailwind size class. The SVG has no width of its own and fills this. */
  size?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        size,
        "shrink-0 overflow-hidden rounded-full [&>svg]:size-full",
        className
      )}
      // Decorative: every place this appears, the person's or Teammate's name
      // is already beside it, so announcing it again is noise for a screen
      // reader rather than information.
      aria-hidden
      dangerouslySetInnerHTML={{ __html: generatedAvatar(seed) }}
    />
  );
}
