/**
 * One Simplified-thinking narration line (#560): what the assistant was doing,
 * in the Visitor's own words, rendered quieter than an answer bubble because it
 * is narration rather than a reply.
 *
 * The single place that shape is displayed — shared by the widget, the admin
 * Preview and the Inbox transcript, like {@link CitationList}. The three surfaces
 * differ only in how wide their bubbles are, so that is the one prop.
 */
export function ProgressLine({
  text,
  className = "max-w-[90%]",
}: {
  text: string;
  className?: string;
}) {
  return (
    <p className={`text-muted-foreground px-1 text-xs italic ${className}`}>
      {text}
    </p>
  );
}
