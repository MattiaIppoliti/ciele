import { z } from "zod";

/**
 * The invite box takes several addresses at once (#1074): pasted from a mail
 * client or a spreadsheet, separated by commas, semicolons, spaces or new
 * lines. Each address becomes its own invite; one bad address holds the whole
 * submit, because inviting nine of ten and naming the tenth in a toast is
 * easy to miss.
 */

/** One submit creates at most this many invites. */
export const MAX_INVITES_PER_SUBMIT = 20;

// The schema `createInviteOp` parses its `email` with (packages/ops,
// organization.ts). The same one, not a look-alike: an address this passes
// and the operation refuses would throw halfway through a submit, after the
// addresses before it were already invited.
const EMAIL = z.string().email();

export interface ParsedInviteEmails {
  /** Valid, lower-cased, de-duplicated, in the order typed. */
  emails: string[];
  /** What was typed and is not an address, as typed. */
  invalid: string[];
  /** More than `MAX_INVITES_PER_SUBMIT` valid addresses. */
  tooMany: boolean;
}

export function parseInviteEmails(text: string): ParsedInviteEmails {
  const emails: string[] = [];
  const invalid: string[] = [];
  // "Ada Lovelace <ada@example.com>" from a mail client keeps the address and
  // drops the name, which would otherwise read as two invalid words.
  const plain = text.replace(/[^,;<>\n]*<([^<>]+)>/g, " $1 ");
  for (const raw of plain.split(/[\s,;]+/)) {
    const token = raw.trim();
    if (!token) continue;
    const email = token.toLowerCase();
    if (!EMAIL.safeParse(email).success) {
      invalid.push(raw);
      continue;
    }
    if (!emails.includes(email)) emails.push(email);
  }
  return { emails, invalid, tooMany: emails.length > MAX_INVITES_PER_SUBMIT };
}

/**
 * Which addresses still need an invite. One that already has a pending invite
 * or already belongs to a member is skipped, so a submit retried after a
 * partial failure creates only what is missing instead of a second invite for
 * everyone the first attempt reached.
 */
export function planInvites(
  emails: readonly string[],
  existing: { invited: readonly string[]; members: readonly string[] }
): { create: string[]; alreadyInvited: string[]; alreadyMembers: string[] } {
  const invited = new Set(existing.invited.map((email) => email.toLowerCase()));
  const members = new Set(existing.members.map((email) => email.toLowerCase()));
  const create: string[] = [];
  const alreadyInvited: string[] = [];
  const alreadyMembers: string[] = [];
  for (const email of emails) {
    if (members.has(email)) alreadyMembers.push(email);
    else if (invited.has(email)) alreadyInvited.push(email);
    else create.push(email);
  }
  return { create, alreadyInvited, alreadyMembers };
}

/** What one submit did: the invites made, the addresses skipped, the ones that failed. */
export interface InviteOutcome<Invite> {
  created: Invite[];
  alreadyInvited: string[];
  alreadyMembers: string[];
  failed: Array<{ email: string; message: string }>;
}

/**
 * What the form says after a submit, and what it leaves in the box: only the
 * addresses that failed, so submitting again retries those and nothing else.
 */
export function describeInviteOutcome(outcome: InviteOutcome<unknown>): {
  tone: "success" | "error";
  message: string;
  keep: string;
} {
  const { created, alreadyInvited, alreadyMembers, failed } = outcome;
  const sentences: string[] = [];
  if (failed.length) {
    const [first] = failed;
    sentences.push(
      failed.length === 1 && first
        ? `Could not invite ${first.email}: ${first.message}`
        : `Could not invite ${failed.length} addresses: ${failed.map((f) => f.email).join(", ")}`
    );
  }
  if (created.length) {
    sentences.push(created.length === 1 ? "1 invite created" : `${created.length} invites created`);
  }
  if (alreadyInvited.length) sentences.push(`Already invited: ${alreadyInvited.join(", ")}`);
  if (alreadyMembers.length) sentences.push(`Already members: ${alreadyMembers.join(", ")}`);
  return {
    tone: failed.length ? "error" : "success",
    message: sentences.join(". ") || "Nothing to invite",
    keep: failed.map((f) => f.email).join(", "),
  };
}
