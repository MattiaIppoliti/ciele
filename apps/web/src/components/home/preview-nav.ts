import {
  Archive,
  Bell,
  BookText,
  ChartLine,
  CircleHelp,
  Compass,
  FlaskConical,
  LayoutGrid,
  Lock,
  MessageCircle,
  PenTool,
  Phone,
  Plane,
  Settings,
  SlidersHorizontal,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * The sidebar the marketing hero's app mock draws.
 *
 * Deliberately its own list rather than an import of `components/shell/nav`.
 * The mock needs a *picture* of the console (labels, icons, order) and none of
 * what makes that module the console's routing config: hrefs, active-state match
 * prefixes, `adminOnly`, the Settings dialog's entry point, or the path helpers.
 * Reading it from here dragged the admin shell's configuration into the
 * marketing pages' module graph, so a renamed route prefix invalidated the
 * marketing build and the mock carried config it never looked at.
 *
 * The marketing claim: that this is what the product actually looks like, is
 * kept honest by `preview-nav.test.ts`, which fails if these labels drift from
 * the real navigation. A build-time assertion instead of a runtime dependency,
 * the same trade `console-routes.test.ts` makes for the console/public split.
 */

/** One row of the mock's sidebar. No href: nothing in the mock navigates. */
export interface PreviewNavItem {
  label: string;
  icon: LucideIcon;
  /** Drawn below the divider at the bottom of the sidebar, as in the console. */
  bottom?: boolean;
}

export const PREVIEW_GLOBAL_NAV: PreviewNavItem[] = [
  { label: "Assistants", icon: LayoutGrid },
  { label: "Help Desks", icon: CircleHelp },
  { label: "Inbox", icon: Archive },
  { label: "Improvements", icon: FlaskConical },
  { label: "Insights", icon: ChartLine },
  { label: "Library", icon: BookText },
  { label: "Alerts", icon: Bell, bottom: true },
  { label: "Settings", icon: Settings, bottom: true },
];

/** One SETUP row. `slug` keys the faked pane behind it, not a route. */
export interface PreviewSetupSection {
  label: string;
  slug: string;
  icon: LucideIcon;
}

export const PREVIEW_SETUP_SECTIONS: PreviewSetupSection[] = [
  { label: "Preview", slug: "preview", icon: MessageCircle },
  { label: "General", slug: "general", icon: SlidersHorizontal },
  { label: "Knowledge", slug: "knowledge", icon: BookText },
  { label: "Flows", slug: "flows", icon: Workflow },
  { label: "Tools & Skills", slug: "tools", icon: Wrench },
  { label: "Goals", slug: "goals", icon: Compass },
  { label: "Assistant Help Desks", slug: "help-desks", icon: Phone },
  { label: "Style", slug: "style", icon: PenTool },
  { label: "Authentication", slug: "authentication", icon: Lock },
  { label: "Publish", slug: "publish", icon: Plane },
];
