import type { FlowAction, FlowTrigger } from "@agent-hub/core";
import {
  AtSign,
  BellRing,
  ChartLine,
  CircleHelp,
  Headphones,
  MessageSquare,
  PanelTop,
  Route,
  Search,
  SquareArrowOutUpRight,
  Webhook,
  type LucideIcon,
} from "lucide-react";

/**
 * The four events that can start a Flow, as an admin reads them. Shared by the
 * builder's Trigger step and the Flows list, so the two never drift.
 */
export const FLOW_TRIGGER_LABELS: Record<FlowTrigger, string> = {
  message: "User sends a message",
  page_load: "On page load",
  time_on_page: "Time on page",
  chat_open: "Chat opens",
};

export interface FlowActionMeta {
  label: string;
  /** One-line description shown on the "Add an action" tiles. */
  subtitle: string;
  icon: LucideIcon;
  beta?: boolean;
}

export const FLOW_ACTIONS: Record<FlowAction, FlowActionMeta> = {
  custom_message: {
    label: "Message",
    subtitle: "Send a custom text reply",
    icon: MessageSquare,
  },
  show_button: {
    label: "Button",
    subtitle: "Show a clickable button or link",
    icon: SquareArrowOutUpRight,
  },
  search_knowledge: {
    label: "Search knowledge",
    subtitle: "Look up your knowledge base",
    icon: Search,
  },
  follow_up_questions: {
    label: "Follow-ups",
    subtitle: "Suggest follow-up questions",
    icon: CircleHelp,
  },
  iframe: {
    label: "Iframe",
    subtitle: "Embed external content inline",
    icon: PanelTop,
  },
  api_request: {
    label: "API request",
    subtitle: "Call an external API endpoint",
    icon: Webhook,
  },
  send_email: {
    label: "Send email",
    subtitle: "Send email",
    icon: AtSign,
  },
  improvement: {
    label: "Improvement",
    subtitle: "Flag for review tracking",
    icon: ChartLine,
  },
  handover: {
    label: "Handover",
    subtitle: "Transfer to another assistant",
    icon: Route,
    beta: true,
  },
  suggest_help_desk: {
    label: "Suggest help desk",
    subtitle: "Offer the help-desk escalation button",
    icon: Headphones,
  },
  notification: {
    label: "Notification",
    subtitle: "Send a proactive in-widget message",
    icon: BellRing,
  },
};

export const FLOW_ACTION_KEYS = Object.keys(FLOW_ACTIONS) as FlowAction[];

/**
 * Tiles offered in the builder's "Add an action" grid for a message-triggered
 * flow, in display order. A proactive trigger has its own single action (see
 * `PROACTIVE_FLOW_ACTION_PICKER`) — the pairing rule itself lives in
 * `actionAllowedForTrigger` (`@agent-hub/core`), which both the editor and the
 * runtime consult.
 */
export const FLOW_ACTION_PICKER: FlowAction[] = [
  "custom_message",
  "show_button",
  "search_knowledge",
  "follow_up_questions",
  "iframe",
  "api_request",
  "send_email",
  "improvement",
  "handover",
];

/** The Response step's catalog for a proactively-triggered flow. */
export const PROACTIVE_FLOW_ACTION_PICKER: FlowAction[] = ["notification"];
