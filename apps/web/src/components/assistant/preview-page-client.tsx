"use client";

import dynamic from "next/dynamic";
import type { Assistant } from "@agent-hub/core";

/**
 * The live preview as a route of its own. Same component as the editor's
 * right-hand panel, that panel is pointer-only chrome hidden below `md`, so
 * this is the only way to reach the preview from a phone or a portrait tablet.
 *
 * Client-only for the same reason the docked panel is: it streams a turn and
 * talks to `localStorage` for the connector preferences.
 */
const PreviewPanel = dynamic(
  () => import("./preview-panel").then((module) => module.PreviewPanel),
  { ssr: false }
);

export function PreviewPageClient({
  assistant,
  connectorScope,
}: {
  assistant: Assistant;
  connectorScope: string | null;
}) {
  return (
    <PreviewPanel
      assistant={assistant}
      connectorScope={connectorScope}
      variant="page"
    />
  );
}
