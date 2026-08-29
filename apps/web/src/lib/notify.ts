import type { EmailMessage } from "@agent-hub/agent";

/**
 * Improvement notification templates.
 *
 * The reference platform emails the assignee when an Improvement is assigned
 * to them, and the reporter when the owner closes it. These build the
 * messages; sending goes through the one email transport (`sendEmail` in
 * email.ts), see actions.ts.
 */

/** Email sent to the member an improvement was just assigned to. */
export function improvementAssignedEmail(input: {
  to: string;
  key: string;
  title: string;
  actorEmail: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: `You were assigned ${input.key}: ${input.title}`,
    body: `${input.actorEmail} assigned improvement ${input.key} ("${input.title}") to you.`,
  };
}

/** Email sent to the reporter when an improvement is closed (marked Done). */
export function improvementClosedEmail(input: {
  to: string;
  key: string;
  title: string;
  actorEmail: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: `${input.key} was resolved: ${input.title}`,
    body: `${input.actorEmail} marked improvement ${input.key} ("${input.title}") as done.`,
  };
}
