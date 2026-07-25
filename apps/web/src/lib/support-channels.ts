import type {
  ChannelConversationData,
  ChannelFieldType,
  ChannelFormField,
  ChannelKind,
  SupportChannelConfig,
  WeekDay,
} from "@agent-hub/db";
import { findCountry } from "./countries";
import {
  AlignLeft,
  AtSign,
  Calendar,
  ChevronDown,
  FileText,
  Hash,
  Link2,
  List,
  Mail,
  MessageCircle,
  Phone,
  Share2,
  SquareArrowOutUpRight,
  SquareCheck,
  Ticket,
  Upload,
  UserRound,
  Webhook,
  type LucideIcon,
} from "lucide-react";

export interface ChannelKindMeta {
  label: string;
  subtitle: string;
  icon: LucideIcon;
  defaultName: string;
  /** Needs the ticketing integration — selectable in a later iteration. */
  requiresTicketing?: boolean;
}

export const CHANNEL_KINDS: Record<ChannelKind, ChannelKindMeta> = {
  email: {
    label: "Email",
    subtitle: "Send escalations via email to your support team",
    icon: Mail,
    defaultName: "Email us",
  },
  phone: {
    label: "Phone number",
    subtitle: "Route users to a phone line for direct support",
    icon: Phone,
    defaultName: "Call us",
  },
  live_chat: {
    label: "Live chat",
    subtitle: "Connect users to a live chat agent",
    icon: MessageCircle,
    defaultName: "Chat with us",
  },
  ticket: {
    label: "Create a ticket",
    subtitle: "Create a support ticket in your ticketing system",
    icon: Ticket,
    defaultName: "Create a ticket",
    requiresTicketing: true,
  },
  external_link: {
    label: "External link",
    subtitle: "Redirect users to an external URL",
    icon: SquareArrowOutUpRight,
    defaultName: "Visit our help center",
  },
  salesforce_chat: {
    label: "Salesforce Chat Handover",
    subtitle: "Hand off to Salesforce Embedded Service Chat",
    icon: Share2,
    defaultName: "Chat with an agent",
    requiresTicketing: true,
  },
  api_endpoint: {
    label: "API endpoint",
    subtitle: "Send form data to a custom API endpoint",
    icon: Webhook,
    defaultName: "Contact us",
  },
};

export const CHANNEL_KIND_ORDER: ChannelKind[] = [
  "email",
  "phone",
  "live_chat",
  "ticket",
  "external_link",
  "salesforce_chat",
  "api_endpoint",
];

export const FIELD_TYPES: Record<
  ChannelFieldType,
  { label: string; icon: LucideIcon }
> = {
  user_email: { label: "User email", icon: AtSign },
  student_number: { label: "ID number", icon: Hash },
  user_role: { label: "User role", icon: UserRound },
  short_text: { label: "Short text", icon: FileText },
  long_text: { label: "Long text", icon: AlignLeft },
  phone: { label: "Phone number", icon: Phone },
  dropdown: { label: "Dropdown", icon: ChevronDown },
  date: { label: "Date select", icon: Calendar },
  url: { label: "URL", icon: Link2 },
  checkbox: { label: "Checkbox", icon: SquareCheck },
  file: { label: "File upload", icon: Upload },
  string_list: { label: "List of string", icon: List },
};

export const FIELD_TYPE_ORDER: ChannelFieldType[] = [
  "user_email",
  "student_number",
  "user_role",
  "short_text",
  "long_text",
  "phone",
  "dropdown",
  "date",
  "url",
  "checkbox",
  "file",
  "string_list",
];

function fieldId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Starter form per channel kind, mirrored in the create step's summary. */
export function defaultFormFor(kind: ChannelKind): ChannelFormField[] {
  if (kind === "email" || kind === "ticket" || kind === "api_endpoint") {
    return [
      {
        id: fieldId(),
        type: "user_email",
        label: "Email",
        required: true,
        useAsReplyTo: true,
        showInForm: true,
      },
      {
        id: fieldId(),
        type: "short_text",
        label: "Subject",
        required: true,
        showInForm: true,
      },
      {
        id: fieldId(),
        type: "long_text",
        label: "Description",
        required: true,
        showInForm: true,
      },
    ];
  }
  return [];
}

/**
 * Why a channel can't act yet: the kind-specific destination the escalation
 * menu needs (the mailto/tel/url target, or the address an email form submits
 * to). A channel saved without it renders as a dead button in the widget, so
 * the editor blocks create/save until it's filled.
 */
export function channelSetupError(
  kind: ChannelKind,
  config: SupportChannelConfig
): string | null {
  if (kind === "email") {
    const email = (config.destinationEmail ?? "").trim();
    if (!email) return "Destination email is required";
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return "Destination email must be a valid email address";
    }
  }
  if (kind === "phone") {
    const dialDigits = findCountry(config.phoneCountry).dialCode.replace(/\D/g, "");
    const digits = (config.phoneNumber ?? "").replace(/\D/g, "");
    if (digits.length <= dialDigits.length) return "Phone number is required";
  }
  if (kind === "live_chat" && !(config.url ?? "").trim()) {
    return "Live chat URL is required";
  }
  if (kind === "external_link" && !(config.url ?? "").trim()) {
    return "Link URL is required";
  }
  if (kind === "api_endpoint" && !(config.url ?? "").trim()) {
    return "API Endpoint URL is required";
  }
  return null;
}

export function newFormField(): ChannelFormField {
  return {
    id: fieldId(),
    type: "short_text",
    label: "New field",
    required: false,
    showInForm: true,
  };
}

export const CONVERSATION_DATA_ITEMS: Array<{
  key: keyof ChannelConversationData;
  label: string;
  description: string;
}> = [
  {
    key: "chatSummary",
    label: "Chat summary",
    description: "1-2 paragraph AI generated summary of what was discussed",
  },
  {
    key: "fullChatHistory",
    label: "Full chat history",
    description: "All user messages and AI responses with timestamps",
  },
  {
    key: "userData",
    label: "User data",
    description: "All user data fields are included by default",
  },
  {
    key: "metadata",
    label: "Conversation metadata",
    description: "All conversation metadata fields are included by default",
  },
];

export const WEEK_DAY_LABELS: Record<WeekDay, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};
