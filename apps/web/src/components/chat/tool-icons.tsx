import type { ReactNode } from "react";
import {
  BookOpen,
  Brain,
  FileText,
  List,
  Palette,
  Plug,
  Search,
  Workflow,
  Wrench,
} from "lucide-react";
import type { StepStage, TurnStep } from "@agent-hub/agent/client";

/**
 * Per-step icon lookup for the Thinking panel / ToolCallsSection. Every
 * Thinking Step gets the icon that matches what it is — flow (routing),
 * palette (generating the answer), search, book (knowledge), or wrench
 * (any tool call) — in the panel's muted monochrome palette, never one icon
 * reused for every step.
 */

interface IconSpec {
  icon: ReactNode;
  /** Human label, used for the icon's tooltip/title. */
  name: string;
}

/**
 * The knowledge tools keep book-shaped icons (they ARE the knowledge lookup) and
 * the API catalogue triad reads as one family, so a row of chips shows at a
 * glance that a turn discovered, read a contract, then queried. Every other tool
 * call — built-in or custom HTTP tool — is a wrench.
 */
const TOOL_ICONS: Record<string, IconSpec> = {
  searchKnowledge: {
    icon: <BookOpen className="size-3.5" />,
    name: "Knowledge search",
  },
  readKnowledgeSource: {
    icon: <FileText className="size-3.5" />,
    name: "Reading a source",
  },
  getApiDetails: {
    icon: <List className="size-3.5" />,
    name: "API endpoint catalogue",
  },
  viewEndpointDetails: {
    icon: <FileText className="size-3.5" />,
    name: "Endpoint details",
  },
  queryApi: {
    icon: <Plug className="size-3.5" />,
    name: "API query",
  },
  readApiResponse: {
    icon: <Plug className="size-3.5" />,
    name: "Reading an API response",
  },
};

/** Any tool call without a more specific icon (custom HTTP tools, remember, …). */
const TOOL_ICON: IconSpec = {
  icon: <Wrench className="size-3.5" />,
  name: "Tool call",
};

const STAGE_ICONS: Record<StepStage, IconSpec> = {
  classify: {
    icon: <Workflow className="size-3.5" />,
    name: "Routing to a flow",
  },
  generate: {
    icon: <Palette className="size-3.5" />,
    name: "Generating answer",
  },
  search: {
    icon: <Search className="size-3.5" />,
    name: "Searching",
  },
  found: {
    icon: <BookOpen className="size-3.5" />,
    name: "Found results",
  },
};

const THOUGHT_ICON: IconSpec = {
  icon: <Brain className="size-3.5" />,
  name: "Reasoning",
};

const DEFAULT_STEP_ICON: IconSpec = {
  icon: <Search className="size-3.5" />,
  name: "Step",
};

function iconSpecFor(step: TurnStep): IconSpec {
  if (step.kind === "tool") {
    return (step.tool && TOOL_ICONS[step.tool]) || TOOL_ICON;
  }
  if (step.kind === "thought") return THOUGHT_ICON;
  return (step.stage && STAGE_ICONS[step.stage]) || DEFAULT_STEP_ICON;
}

/** snake_case or camelCase tool identifier → "Title Case" display name. */
export function formatToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** The muted icon circle for one step — same palette as the rest of the panel. */
export function StepIcon({
  step,
  className = "size-6",
}: {
  step: TurnStep;
  className?: string;
}) {
  const spec = iconSpecFor(step);
  return (
    <span
      title={spec.name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ${className}`}
    >
      {spec.icon}
    </span>
  );
}

export function stepIconName(step: TurnStep): string {
  return iconSpecFor(step).name;
}
