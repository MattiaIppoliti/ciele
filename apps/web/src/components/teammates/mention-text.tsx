import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import { splitMentions, type MentionTarget } from "@/lib/teammates/mention";

/**
 * A channel message with its mentions drawn as chips: the face of whoever was
 * named, then the name, on a tinted pill.
 *
 * Chips here and not in the composer, and the split is not arbitrary. A chip has
 * padding and an avatar, so it is wider than the `@Chief of Staff` it replaces,
 * and a `<textarea>` has exactly one text flow: anything wider than the
 * characters underneath it desynchronises the wrapping from the caret. The
 * composer therefore tints the name in place (same glyph advance, see
 * `PromptInput`'s `highlight`), and the posted message, where the layout is
 * free, gets the chip.
 *
 * A name nobody answers to stays prose, because `splitMentions` resolves against
 * the roster: a chip is a promise that somebody was summoned.
 */
export function MentionText({
  text,
  targets,
}: {
  text: string;
  targets: readonly MentionTarget[];
}) {
  const segments = splitMentions(text, targets);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          // `whitespace-pre-wrap`: the bubble's own newlines and runs of spaces
          // are the sender's, and a chip in the middle must not collapse them.
          <span key={index} className="whitespace-pre-wrap">
            {segment.text}
          </span>
        ) : (
          <span
            key={index}
            // `bg-current/20` and no colour of its own: the chip is tinted from
            // whatever text colour it inherits, so it reads on the sender's
            // primary-coloured bubble and would read on a plain one too. A fixed
            // `bg-primary/15 text-primary` was primary-on-primary in the user
            // bubble, which is where every mention a person types ends up.
            //
            // `align-middle`, and no nudge. An inline-flex box takes its
            // baseline from its first flex item, which here is a 14px avatar
            // rather than the name beside it, so `align-baseline` sat the whole
            // chip off the line and a hand-tuned `translate-y` only papered over
            // it at one font size. Middle-aligning centres the chip on the
            // surrounding text's own x-height, which holds at any size.
            className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md bg-current/20 px-1 py-px align-middle text-[0.95em] font-medium"
          >
            <GeneratedAvatar
              seed={segment.target.avatarSeed}
              size="size-3.5"
              className="shrink-0"
            />
            <span className="truncate">{segment.target.name}</span>
          </span>
        )
      )}
    </>
  );
}
