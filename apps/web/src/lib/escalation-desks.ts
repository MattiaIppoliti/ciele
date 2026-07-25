import type {
  ChannelAvailability,
  ChannelFieldType,
  ChannelKind,
  Db,
  SupportChannel,
} from "@agent-hub/db";

/**
 * The escalation menu data shared by the published widget and the editor
 * Preview: the help desks an assistant offers (helpDeskSettings.selectedIds)
 * with their enabled support channels. Only widget-safe fields leave the
 * server — channel auth config (API keys, basic credentials) never does;
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
  /** tel/url target for actionable kinds; null renders as info-only. */
  target: string | null;
  /** Present for email channels — submitting it sends the escalation email. */
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

function toEscalationChannel(c: SupportChannel): EscalationChannel {
  let target: string | null = null;
  let form: EscalationForm | null = null;
  if (c.kind === "email" && c.config.destinationEmail) {
    const fields = visibleFormFields(c);
    if (fields.length > 0) {
      form = {
        title: c.formTitle.trim() || "Helpdesk form",
        fields,
        confirmationMessage: c.confirmationMessage,
      };
    } else {
      // An email channel whose form was emptied still needs a way to act.
      target = `mailto:${c.config.destinationEmail}`;
    }
  } else if (c.kind === "phone" && c.config.phoneNumber) {
    target = `tel:${c.config.phoneNumber.replace(/[^+\d]/g, "")}`;
  } else if (
    (c.kind === "live_chat" || c.kind === "external_link") &&
    c.config.url
  ) {
    target = c.config.url;
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
  }
): { to: string; subject: string; body: string; replyTo?: string } {
  const fields = visibleFormFields(channel);
  const value = (id: string) => (values[id] ?? "").trim();

  const subjectField = fields.find((f) => f.label.trim().toLowerCase() === "subject");
  const subject =
    (subjectField && value(subjectField.id)) ||
    `Support request — ${context.deskName}`;

  const replyToField = channel.form.find(
    (f) => f.useAsReplyTo && f.showInForm !== false
  );
  const replyTo = replyToField ? value(replyToField.id) || undefined : undefined;

  const lines = [
    `New support request from "${context.assistantTitle}" — ${context.deskName} / ${channel.name}.`,
    "",
    ...fields.map((f) => `${f.label}: ${value(f.id) || "—"}`),
  ];
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

export async function listEscalationDesks(
  db: Db,
  organizationId: string,
  selectedIds: string[]
): Promise<EscalationHelpDesk[]> {
  const all = await db.listHelpDesks(organizationId);
  const desks = all.filter((desk) => selectedIds.includes(desk.id));

  return Promise.all(
    desks.map(async (desk) => {
      const channels = await db.listSupportChannels(desk.id);
      return {
        id: desk.id,
        name: desk.name,
        channels: channels
          .filter((c) => c.enabled)
          .map(toEscalationChannel)
          // An email channel without a destination address can neither open a
          // form nor a mailto — hide it rather than render a dead button.
          .filter((c) => c.kind !== "email" || c.target !== null || c.form !== null),
      };
    })
  );
}
