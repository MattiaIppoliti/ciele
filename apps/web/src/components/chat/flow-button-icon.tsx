import type { FlowButtonIcon as FlowButtonIconName } from "@agent-hub/core";
import type { CSSProperties } from "react";
import {
  Bell,
  ExternalLink,
  Headphones,
  Headset,
  Mail,
  MessageCircle,
  Phone,
  type LucideIcon,
} from "lucide-react";

export const FLOW_BUTTON_ICON_OPTIONS: Array<{
  value: FlowButtonIconName;
  label: string;
}> = [
  { value: "message", label: "Message" },
  { value: "phone", label: "Phone" },
  { value: "headset", label: "Headset" },
  { value: "bell", label: "Bell" },
  { value: "mail", label: "Mail" },
];

const ICONS: Record<FlowButtonIconName, LucideIcon> = {
  message: MessageCircle,
  phone: Phone,
  headset: Headset,
  bell: Bell,
  mail: Mail,
  external_link: ExternalLink,
  headphones: Headphones,
};

export function FlowButtonIcon({
  icon = "message",
  className,
  style,
}: {
  icon?: FlowButtonIconName;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = ICONS[icon];
  return <Icon className={className} style={style} />;
}
