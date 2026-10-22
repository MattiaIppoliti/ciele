"use client";

import type { ReactNode } from "react";
import { WorkspacePanel } from "@/components/ui/workspace-panel";

/** The Improvements board's docked detail: the shared panel, named for it. */
export function ImprovementWorkspace(props: {
  open: boolean;
  onClose: () => void;
  detail: ReactNode;
  children: ReactNode;
}) {
  return <WorkspacePanel {...props} label="Improvement" slot="improvement" />;
}
