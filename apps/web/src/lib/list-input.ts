/**
 * One text field, a list behind it.
 *
 * A field whose `value` is `stored.join(", ")` and whose `onChange` splits that
 * text back apart cannot be typed in: the keystroke that adds the separator
 * parses to the list already held, the parent re-renders with the same array,
 * and React puts the old text back. The separator can only ever be pasted. Two
 * fields shipped that way (`flow-human-review-config.tsx`), so the rule lives
 * here rather than in each of them: the field owns the raw text, this module
 * owns the translation, and {@link sameList} is how a component tells its own
 * echo from a change that came from somewhere else.
 */

/** The default separators: what a Member types between two addresses. */
const DEFAULT_SEPARATORS = /[,\s;]+/;

/**
 * Split typed text into the list it means. `separator` narrows the set when a
 * value may contain spaces of its own (dropdown options are commas only).
 */
export function parseListInput(text: string, separator?: string): string[] {
  const parts = separator ? text.split(separator) : text.split(DEFAULT_SEPARATORS);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Render a stored list as the text a Member would have typed to produce it. */
export function listInputText(values: readonly string[] | undefined): string {
  return (values ?? []).join(", ");
}

/** Same values, same order. Absent and empty are the same list. */
export function sameList(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((value, i) => value === right[i]);
}
