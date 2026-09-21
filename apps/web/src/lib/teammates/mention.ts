import type { ChannelRosterEntry } from "@agent-hub/core";
import {
  activeToken,
  matchByName,
  replaceToken,
  type ActiveToken,
} from "@/lib/composer/token";

/**
 * The @ picker's logic (#778): what token the caret is inside, who matches it,
 * and what the text becomes when a name is picked.
 *
 * Pure and separate from the composer component because vitest only runs `.ts`
 * files here (see apps/web/CLAUDE.md), and because these three answers have to
 * agree with `parseChannelMentions` in `@agent-hub/core`: a name the picker
 * inserts must be a name the resolver later finds. That is why matching is
 * case-insensitive and why names keep their spaces, the resolver reads both.
 *
 * The caret arithmetic itself is `lib/composer/token.ts`, shared with the two
 * other triggers a composer now carries. What stays here is everything the
 * channel means by a mention: who ranks above whom, and which runs of a posted
 * message are names rather than prose.
 */

/** Someone the picker can offer: a roster entry plus what the list renders. */
export interface MentionTarget extends ChannelRosterEntry {
  /** Seed for the generated face, resolved by the caller (`rosterAvatarSeed`). */
  avatarSeed: string;
  /** A Teammate's title, shown small under the name. */
  title?: string;
}

/** The @token under the caret: where its `@` sits, and what follows it. */
export type ActiveMention = ActiveToken;

/** The mention token the caret is inside, or null when it is not in one. */
export function activeMention(
  text: string,
  caret: number
): ActiveMention | null {
  return activeToken(text, caret, "@");
}

/**
 * Who the token matches, Teammates first because they are the ones an `@`
 * actually summons; people follow, since naming a colleague is still worth
 * completing. Prefix matches beat substring matches within each kind, so
 * typing `A` puts Ada above Sam even though both contain an "a".
 */
export function mentionMatches(
  targets: readonly MentionTarget[],
  query: string
): MentionTarget[] {
  return matchByName(targets, query, (target) =>
    target.kind === "teammate" ? 0 : 1
  );
}

/**
 * The text after picking a name: the token (from its `@` to the caret) becomes
 * `@Name ` and the caret lands after the trailing space, ready to keep typing.
 */
export function insertMention(
  text: string,
  mention: ActiveMention,
  caret: number,
  name: string
): { text: string; caret: number } {
  return replaceToken(text, mention, caret, `@${name} `);
}

/** One run of a message: plain prose, or a name that resolved to somebody. */
export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; target: MentionTarget };

/**
 * A message split into prose and resolved mentions, so a surface can draw the
 * names differently from the words around them.
 *
 * Only names that resolve against the roster become segments. An `@` followed
 * by something nobody is called stays prose, which is the same answer
 * `parseChannelMentions` gives the runtime: a mention that summons nobody is
 * not a mention, and drawing it as one would promise a reply that never comes.
 *
 * Longest name first, so "Chief of Staff" is not matched as "Chief" with the
 * rest left as prose. Matching is case-insensitive and the segment keeps the
 * text **as typed**, because the message is what the person wrote, not a
 * normalised copy of it.
 */
export function splitMentions(
  text: string,
  targets: readonly MentionTarget[]
): MentionSegment[] {
  const named = [...targets]
    .filter((target) => target.name.trim().length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  if (named.length === 0) return text ? [{ kind: "text", text }] : [];

  const segments: MentionSegment[] = [];
  let plain = "";
  let index = 0;

  const flush = () => {
    if (plain) segments.push({ kind: "text", text: plain });
    plain = "";
  };

  while (index < text.length) {
    // Same gate as `activeMention`: an `@` only starts a name at the beginning
    // or after whitespace, so `name@example.com` is an address, not a mention.
    const before = text[index - 1];
    const opens = text[index] === "@" && (!before || /\s/.test(before));
    const target = opens
      ? named.find(
          (candidate) =>
            text
              .slice(index + 1, index + 1 + candidate.name.length)
              .toLowerCase() === candidate.name.toLowerCase()
        )
      : undefined;
    if (!target) {
      plain += text[index];
      index += 1;
      continue;
    }
    flush();
    const end = index + 1 + target.name.length;
    segments.push({ kind: "mention", text: text.slice(index, end), target });
    index = end;
  }
  flush();
  return segments;
}
