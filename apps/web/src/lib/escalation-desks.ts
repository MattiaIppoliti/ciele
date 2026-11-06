import type {
  BusinessHoursCalendar,
  ChannelAvailability,
  ChannelFieldType,
  ChannelKind,
  SupportChannel,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

/**
 * The escalation menu data shared by the published widget and the editor
 * Preview: the help desks an assistant offers (helpDeskSettings.selectedIds)
 * with their enabled support channels. Only widget-safe fields leave the
 * server, channel auth config (API keys, basic credentials) never does;
 * each kind exposes just what the client needs to act.
 */
export interface EscalationFormField {
  id: string;
  type: ChannelFieldType;
  label: string;
  placeholder?: string;
  usePlaceholderAsDefault?: boolean;
  required?: boolean;
  /** Choices for dropdown / list fields. */
  options?: string[];
}

/** The channel's escalation form, as built in the desk's Form tab. */
export interface EscalationForm {
  title: string;
  fields: EscalationFormField[];
  confirmationMessage: string;
}

export interface EscalationChannel {
  id: string;
  kind: ChannelKind;
  name: string;
  availability: ChannelAvailability;
  businessHours?: BusinessHoursCalendar;
  /** tel/url target for actionable kinds; null renders as info-only. */
  target: string | null;
  /** Present for email channels, submitting it sends the escalation email. */
  form: EscalationForm | null;
}

export interface EscalationHelpDesk {
  id: string;
  name: string;
  channels: EscalationChannel[];
}

/** Select a requested desk, or the only available desk as a convenience. */
export function initialEscalationDesk(
  desks: EscalationHelpDesk[],
  helpDeskId?: string
): EscalationHelpDesk | null {
  return (
    desks.find((desk) => desk.id === helpDeskId) ??
    (desks.length === 1 ? desks[0] : null)
  );
}

/**
 * The channel's form fields a visitor actually fills in: visible ones only,
 * minus file uploads (no upload backend on the widget surface yet).
 */
export function visibleFormFields(
  channel: SupportChannel
): EscalationFormField[] {
  return channel.form
    .filter((f) => f.showInForm !== false && f.type !== "file")
    .map((f) => ({
      id: f.id,
      type: f.type,
      label: f.label,
      placeholder: f.placeholder,
      usePlaceholderAsDefault: f.usePlaceholderAsDefault,
      required: f.required,
      options: f.options,
    }));
}

/** Contact links have no form submission; the runtime uses this same eligibility check. */
export function contactChannelTarget(c: SupportChannel): string | null {
  if (c.kind === "email" && c.config.destinationEmail && visibleFormFields(c).length === 0) return `mailto:${c.config.destinationEmail}`;
  if (c.kind === "phone" && c.config.phoneNumber) return `tel:${c.config.phoneNumber.replace(/[^+\d]/g, "")}`;
  if ((c.kind === "live_chat" || c.kind === "external_link") && c.config.url) return c.config.url;
  return null;
}

function toEscalationChannel(
  c: SupportChannel,
  desk: { ticketingReady: boolean } = { ticketingReady: false }
): EscalationChannel {
  const target = contactChannelTarget(c);
  let form: EscalationForm | null = null;
  if (c.kind === "email" && c.config.destinationEmail) {
    const fields = visibleFormFields(c);
    if (fields.length > 0) {
      form = {
        title: c.formTitle.trim() || "Helpdesk form",
        fields,
        confirmationMessage: c.confirmationMessage,
      };
    }
  } else if (c.kind === "ticket" && desk.ticketingReady) {
    // A ticket channel files into the desk's ticketing target (#1088). With
    // no target there is nowhere to file, so it stays info-only.
    form = {
      title: c.formTitle.trim() || "Create a ticket",
      fields: visibleFormFields(c),
      confirmationMessage: c.confirmationMessage,
    };
  } else if (c.kind === "live_operator") {
    // The Visitor stays in the chat (#1083): the optional form is all there
    // is to fill in, and submitting it starts the wait.
    form = {
      title: c.formTitle.trim() || "Talk to a person",
      fields: visibleFormFields(c),
      confirmationMessage: c.confirmationMessage,
    };
  } else if (c.kind === "api_endpoint" && c.config.url) {
    // API-endpoint channels submit their form to the configured endpoint
    // (#315). A form with no visible fields still renders a submit action.
    form = {
      title: c.formTitle.trim() || "Helpdesk form",
      fields: visibleFormFields(c),
      confirmationMessage: c.confirmationMessage,
    };
  }
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    availability: c.availability,
    target,
    form,
  };
}

/**
 * What the Visitor reads after a ticket channel filed (#1088): the desk's own
 * confirmation, followed by the number they can quote. The number is the
 * one thing a Visitor needs to follow up, so it is never left to the
 * confirmation text an admin may have written without it.
 */
export function ticketConfirmationText(
  confirmationMessage: string,
  ticket: { number: string | null } | null | undefined
): string {
  const base =
    confirmationMessage.trim() ||
    "Thanks! Your request has been sent, our team will get back to you.";
  return ticket?.number ? `${base}\n\nYour ticket number is ${ticket.number}.` : base;
}

/** What the Visitor reads when the ticket could not be filed. */
export const TICKET_NOT_FILED =
  "We couldn't confirm your ticket. Please contact the team through another channel before sending a new request.";

/** The one line an escalation carries when its Chat summary could not be produced (#1081). */
export const SUMMARY_UNAVAILABLE = "Summary unavailable";

/** A filed ticket and the Conversation the Visitor continues in. */
export interface TicketConfirmation {
  number: string;
  url: string;
  conversationId: string;
}

/** Labels of visible required fields missing from a form submission. */
export function missingRequiredFields(
  channel: SupportChannel,
  values: Record<string, string>
): string[] {
  return visibleFormFields(channel)
    .filter((f) => f.required && !(values[f.id] ?? "").trim())
    .map((f) => f.label);
}

/**
 * The escalation email for a submitted channel form, built from how the
 * desk's Form tab configured it: every visible field becomes a "Label: value"
 * line, the field labeled "Subject" becomes the subject, and the field marked
 * "Use as reply to" becomes the Reply-To.
 */
export function buildEscalationEmail(
  channel: SupportChannel,
  values: Record<string, string>,
  context: {
    assistantTitle: string;
    deskName: string;
    /** Rendered transcript, included when the channel attaches chat history. */
    transcript?: string;
    /**
     * The Chat summary (#1081): text when it was produced, null when the
     * channel asked for one and it could not be, absent when not asked.
     */
    summary?: string | null;
  }
): { to: string; subject: string; body: string; replyTo?: string } {
  const fields = visibleFormFields(channel);
  const value = (id: string) => (values[id] ?? "").trim();

  const subjectField = fields.find((f) => f.label.trim().toLowerCase() === "subject");
  const subject =
    (subjectField && value(subjectField.id)) ||
    `Support request, ${context.deskName}`;

  const replyToField = channel.form.find(
    (f) => f.useAsReplyTo && f.showInForm !== false
  );
  const replyTo = replyToField ? value(replyToField.id) || undefined : undefined;

  const lines = [
    `New support request from "${context.assistantTitle}", ${context.deskName} / ${channel.name}.`,
    "",
  ];
  // Above the form fields, so the reader knows the story before the details.
  if (context.summary !== undefined) {
    lines.push(
      ...(context.summary ? ["--- Summary ---", context.summary] : [SUMMARY_UNAVAILABLE]),
      ""
    );
  }
  lines.push(...fields.map((f) => `${f.label}: ${value(f.id) || "N/A"}`));
  if (context.transcript) {
    lines.push("", "--- Conversation ---", context.transcript);
  }

  return {
    to: channel.config.destinationEmail ?? "",
    subject,
    body: lines.join("\n"),
    replyTo,
  };
}

/**
 * `staffedDeskIds` are the desks with an Available operator (#1084), which
 * the caller reads through `desksWithAvailableOperator` in `@ciele/ops`. It is
 * passed in rather than read here because this module's types reach client
 * components, and the operations layer must not. Absent offers no Live
 * operator channel, so a Visitor is never queued for nobody.
 */
export async function listEscalationDesks(
  db: Db,
  organizationId: string,
  selectedIds: string[],
  staffedDeskIds: ReadonlySet<string> = new Set()
): Promise<EscalationHelpDesk[]> {
  const all = await db.listHelpDesks(organizationId);
  const desks = all.filter((desk) => selectedIds.includes(desk.id));
  const staffed = staffedDeskIds;

  return Promise.all(
    desks.map(async (desk) => {
      const channels = await db.listSupportChannels(desk.id);
      const schedules = channels.some(channel => channel.availability.mode === "business_hours") ? await db.table("businessHours").list({ organizationId }).catch((error: unknown) => {
        if (error && typeof error === "object" && "code" in error && ["42P01", "PGRST205"].includes(String(error.code))) return [];
        throw error;
      }) : [];
      return {
        id: desk.id,
        name: desk.name,
        channels: channels
          .filter((c) => c.enabled && (c.kind !== "live_operator" || staffed.has(desk.id)))
          .map((c) => {
            const channel = toEscalationChannel(c, { ticketingReady: Boolean(desk.ticketingTarget) });
            const schedule = c.availability.mode === "business_hours" ? schedules.find(row => row.id === c.availability.businessHoursId) : null;
            return schedule ? { ...channel, businessHours: { id: schedule.id, timezone: schedule.timezone, hours: schedule.hours, holidays: schedule.holidays.map(holiday => ({ startDate: holiday.startDate, endDate: holiday.endDate, yearly: holiday.yearly })) } } : channel;
          })
          // An email channel without a destination address can neither open a
          // form nor a mailto, hide it rather than render a dead button.
          .filter((c) => c.kind !== "email" || c.target !== null || c.form !== null),
      };
    })
  );
}
