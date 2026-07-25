/**
 * Cheap syntax sniff that keeps react-markdown out of the widget's initial
 * chunk: plain text renders as-is, and the rich renderer is only fetched once
 * a message actually contains formatting. False positives are fine — they
 * just load the renderer — so the check errs permissive: any inline markdown
 * character, raw HTML, a bare URL (GFM autolink) or a list/heading/table
 * marker counts as markdown.
 */
const MARKDOWN_HINT = /[\\`*_[\]<>#|~]|https?:\/\/|^[ \t]*(?:[-+]|\d+\.)[ \t]/m;

export function hasMarkdownSyntax(text: string): boolean {
  return MARKDOWN_HINT.test(text);
}
