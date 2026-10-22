import { canReadProject, mentionToken, splitMentionTokens, type Project } from "@agent-hub/core";

/**
 * The comment composer's mentions (#1066), pure so they are tested.
 *
 * A comment is stored with id tokens, `@[Ada](member:<id>)` (#1041), so a
 * rename changes every chip and a mention survives it. The composer cannot
 * show tokens, so it edits plain `@Ada` and remembers whom each name picked;
 * `encodeMentions` turns the picked names back into tokens on send, and
 * `decodeMentions` does the reverse when a comment is edited.
 */

export interface PickedMention {
  id: string;
  name: string;
}

const QUERY = /(^|\s)@([\p{L}\p{N}._-]{0,32})$/u;

/** The `@query` being typed right before the caret, if any. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = QUERY.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, query: match[2]! };
}

/** Replaces the `@query` at `start` with `@Name `, returning the caret after it. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const inserted = `@${name} `;
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Turns each picked `@Name` still in the text into its token. Longer names go
 * first, so "@Ada Lovelace" is never read as "@Ada" followed by " Lovelace".
 * A picked name the writer deleted simply mentions nobody.
 */
export function encodeMentions(text: string, picked: readonly PickedMention[]): string {
  let out = text;
  const unique = [...new Map(picked.map((p) => [p.id, p])).values()].sort((a, b) => b.name.length - a.name.length);
  for (const person of unique) {
    const pattern = new RegExp(`(^|[^\\w\\]])@${escape(person.name)}(?![\\p{L}\\p{N}_])`, "gu");
    out = out.replace(pattern, (_whole, before: string) => `${before}${mentionToken(person.name, person.id)}`);
  }
  return out;
}

/** A stored body back into editable text, each mention under its current name. */
export function decodeMentions(body: string, nameOf: (id: string) => string | null): { text: string; picked: PickedMention[] } {
  const picked: PickedMention[] = [];
  const text = splitMentionTokens(body)
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      const name = nameOf(segment.memberId) ?? segment.name;
      if (!picked.some((p) => p.id === segment.memberId)) picked.push({ id: segment.memberId, name });
      return `@${name}`;
    })
    .join("");
  return { text, picked };
}

interface Candidate {
  userId: string;
  name: string;
  email: string;
  role: Parameters<typeof canReadProject>[2]["role"];
}

/**
 * Who a comment on this Project can mention: the Members who can read it,
 * matched on a name or an email that starts with the query, never the writer.
 */
export function mentionCandidates<T extends Candidate>(
  people: readonly T[],
  project: Pick<Project, "visibility" | "createdBy">,
  memberIds: readonly string[],
  query: string,
  writerId: string,
  limit = 8
): T[] {
  const q = query.toLowerCase();
  const starts = (value: string) => value.toLowerCase().split(/[\s.@_-]+/).some((part) => part.startsWith(q));
  return people
    .filter((person) => person.userId !== writerId)
    .filter((person) => canReadProject(project, memberIds, { userId: person.userId, role: person.role }))
    .filter((person) => !q || starts(person.name) || person.email.toLowerCase().startsWith(q))
    .slice(0, limit);
}
