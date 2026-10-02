/** Tab accepts visible text, never guesses a value or overwrites a selection. */
export function textCompletion({
  value, suggestions, start, end, maxLength = -1,
}: {
  value: string;
  suggestions: readonly string[];
  start: number | null;
  end: number | null;
  maxLength?: number;
}): string | null {
  if (start !== value.length || end !== start) return null;
  return suggestions.find((suggestion) =>
    suggestion.length > value.length &&
    (maxLength < 0 || suggestion.length <= maxLength) &&
    suggestion.toLocaleLowerCase().startsWith(value.toLocaleLowerCase()),
  ) ?? null;
}
