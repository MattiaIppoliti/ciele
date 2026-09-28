/**
 * One markdown-toolbar command over a textarea's value: wrap the selection,
 * prefix the line the selection starts on, or rewrite the selection. The
 * General section's welcome message and the FAQ answer editor share it; each
 * keeps its own focus and caret handling.
 */
export type MarkdownCommand =
  | { wrap: string; wrapEnd?: string }
  | { prefix: string }
  | { transform: (selected: string) => string };

export function applyMarkdownCommand(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  command: MarkdownCommand
): string {
  const selected = value.slice(selectionStart, selectionEnd);
  if ("wrap" in command) {
    const end = command.wrapEnd ?? command.wrap;
    return (
      value.slice(0, selectionStart) + command.wrap + selected + end + value.slice(selectionEnd)
    );
  }
  if ("prefix" in command) {
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    return value.slice(0, lineStart) + command.prefix + value.slice(lineStart);
  }
  return value.slice(0, selectionStart) + command.transform(selected) + value.slice(selectionEnd);
}
