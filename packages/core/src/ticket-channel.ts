import type {
  ApplicationConnection,
  ChannelFormField,
  ConnectorActionSettings,
  FiledTicket,
  TicketingProvider,
  TicketingTarget,
} from "./types";

/**
 * The "Create a ticket" Support Channel as pure functions (#1088, #1089): how
 * a submitted form becomes a ticket, how a ticket becomes the catalogued
 * Connector action that files it, and how that action's outputs become the
 * record the Inbox and the Widget show. The call itself is the runtime's;
 * nothing here performs I/O.
 */

/** A ticket before it is filed, in the provider-neutral words a form gives. */
export interface TicketDraft {
  subject: string;
  description: string;
  requesterEmail: string;
  requesterName: string;
}

/** A Case Subject holds 255 characters; a ServiceNow short description 160 by default. */
const SUBJECT_MAX = 255;
/** A Case Description holds 32,000 characters. */
const DESCRIPTION_MAX = 32_000;

const DEFAULT_SERVICENOW_TABLE = "incident";

function byLabel(fields: ChannelFormField[], pattern: RegExp): ChannelFormField | undefined {
  return fields.find((field) => pattern.test(field.label.trim()));
}

/**
 * The ticket a form submission describes. Fields are recognised by label
 * first ("Subject", "Description", "Name") and by type second, because an
 * admin may rename a field but rarely changes what it is. Every other visible
 * field the Visitor filled in becomes a "Label: value" line, so nothing they
 * typed is dropped on the way to the ticket.
 */
export function ticketFromForm(
  form: ChannelFormField[],
  values: Record<string, string>,
  context: {
    assistantTitle: string;
    deskName: string;
    channelName: string;
    /** The Chat summary (#1081), when the channel's Conversation Data asks for it. */
    summary?: string | null;
    /** The rendered transcript, when the channel's Conversation Data asks for it. */
    transcript?: string;
  }
): TicketDraft {
  const visible = form.filter((field) => field.showInForm !== false && field.type !== "file");
  const value = (field: ChannelFormField | undefined) =>
    field ? (values[field.id] ?? "").trim() : "";

  const emailField =
    visible.find((field) => field.useAsReplyTo && value(field)) ??
    visible.find((field) => field.type === "user_email");
  const nameField = byLabel(visible, /^(full )?name$/i);
  const subjectField =
    byLabel(visible, /^subject$/i) ??
    visible.find(
      (field) => field.type === "short_text" && field !== emailField && field !== nameField
    );
  const descriptionField =
    byLabel(visible, /^description$/i) ??
    visible.find((field) => field.type === "long_text" && field !== subjectField);
  const used = new Set([emailField, subjectField, descriptionField, nameField]);

  const extras = visible
    .filter((field) => !used.has(field) && value(field))
    .map((field) => `${field.label}: ${value(field)}`);

  const blocks: string[] = [];
  if (value(descriptionField)) blocks.push(value(descriptionField));
  if (extras.length > 0) blocks.push(extras.join("\n"));
  if (context.summary?.trim()) blocks.push(`--- Chat summary ---\n${context.summary.trim()}`);
  if (context.transcript?.trim()) blocks.push(`--- Conversation ---\n${context.transcript.trim()}`);
  blocks.push(`Filed from "${context.assistantTitle}", ${context.deskName} / ${context.channelName}.`);

  const subject = value(subjectField) || `Support request, ${context.deskName}`;
  const description = blocks.join("\n\n");
  if (subject.length > SUBJECT_MAX) throw new RangeError("The subject is too long. Use 255 characters or fewer.");
  if (description.length > DESCRIPTION_MAX) {
    throw new RangeError("The ticket content is too long. The limit is 32000 characters, including chat context. Shorten your text or contact the team through another channel.");
  }
  return {
    subject,
    description,
    requesterEmail: value(emailField),
    requesterName: value(nameField),
  };
}

/**
 * The catalogued Connector action that files a draft, so a ticket goes
 * through exactly the code a Flow's Create case / Create record step runs.
 * Every field is given explicitly: the runtime runs these params literally,
 * and a field left out would fall back to its template default.
 */
export function ticketConnectorSettings(
  target: TicketingTarget,
  draft: TicketDraft
): ConnectorActionSettings {
  if (target.provider === "salesforce") {
    return {
      provider: "salesforce",
      connectionId: target.connectionId,
      action: "salesforce.case.create",
      params: {
        subject: draft.subject,
        description: draft.description,
        priority: "",
        status: "",
        origin: "Web",
        supplied_email: draft.requesterEmail,
        supplied_name: draft.requesterName,
      },
    };
  }
  const column = target.requesterEmailField?.trim();
  const columnIssue = requesterEmailColumnIssue(column);
  if (columnIssue) throw new Error(columnIssue);
  const fields: Record<string, string> = {
    short_description: draft.subject,
    description:
      draft.requesterEmail && !column
        ? `${draft.description}\n\nRequester email: ${draft.requesterEmail}`
        : draft.description,
  };
  if (column && draft.requesterEmail) fields[column] = draft.requesterEmail;
  return {
    provider: "servicenow",
    connectionId: target.connectionId,
    action: "servicenow.record.create",
    params: {
      table: target.table.trim() || DEFAULT_SERVICENOW_TABLE,
      fields: JSON.stringify(fields),
    },
  };
}

/** The filed record, from the Create case / Create record outputs. */
export function filedTicketFromOutputs(
  provider: TicketingProvider,
  outputs: Record<string, string>
): FiledTicket {
  return provider === "salesforce"
    ? {
        provider,
        id: outputs.case_id ?? "",
        number: outputs.case_number ?? "",
        url: outputs.case_url ?? "",
      }
    : {
        provider,
        id: outputs.sys_id ?? "",
        number: outputs.number ?? "",
        url: outputs.url ?? "",
      };
}

/**
 * The `sourceKey` of the Alert raised for a desk still holding the retired
 * password-grant ServiceNow registration (20261022100000). Setting a target
 * or removing the registration clears it.
 */
export function ticketingLegacyAlertKey(helpDeskId: string): string {
  return `ticketing-legacy:${helpDeskId}`;
}

const IDENTIFIER = /^[a-z][a-z0-9_]{0,79}$/i;

function requesterEmailColumnIssue(column: string | undefined): string | null {
  if (!column) return null;
  if (!IDENTIFIER.test(column)) return "The requester email column must be a ServiceNow column name";
  if (["description", "short_description"].includes(column.toLowerCase())) {
    return "The requester email column is reserved for ticket content";
  }
  return null;
}

/**
 * Why a Connection cannot be a desk's ticketing target, or null when it can.
 * A Member-owned Connection never can: a Visitor's ticket filed at 03:00 under
 * one Member's account is the line ADR-0001 draws for published traffic.
 */
export function ticketingTargetIssue(
  target: TicketingTarget,
  connection: Pick<ApplicationConnection, "organizationId" | "provider" | "ownerType" | "status"> | null,
  organizationId: string
): string | null {
  if (!connection || connection.organizationId !== organizationId) {
    return "The connection no longer exists";
  }
  if (connection.provider !== target.provider) {
    return `The connection is a ${connection.provider} connection, this target needs ${target.provider}`;
  }
  if (connection.ownerType !== "organization") {
    return "A ticketing target must be an Organization-owned connection";
  }
  if (target.provider === "servicenow") {
    if (target.table.trim() && !IDENTIFIER.test(target.table.trim())) {
      return "Table must be a ServiceNow table name";
    }
    const column = target.requesterEmailField?.trim();
    const columnIssue = requesterEmailColumnIssue(column);
    if (columnIssue) return columnIssue;
  }
  return null;
}
