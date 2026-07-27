import type { FlowAction } from "@agent-hub/core";
import {
  AtSign,
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
};

export const FLOW_ACTION_KEYS = Object.keys(FLOW_ACTIONS) as FlowAction[];

/** Tiles offered in the builder's "Add an action" grid, in display order. */
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
