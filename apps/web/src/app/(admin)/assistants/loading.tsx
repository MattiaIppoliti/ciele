"use client";

import { usePathname } from "next/navigation";
import {
  AssistantSectionLoading,
  type AssistantSectionLoadingVariant,
} from "@/components/assistant/assistant-section-loading";
import { FlowBuilderSkeleton } from "@/components/assistant/flow-builder-skeleton";
import { DocumentSkeleton } from "@/components/knowledge/document-skeleton";
import { SourceDocumentsSkeleton } from "@/components/knowledge/source-documents-skeleton";
import AssistantOverviewLoading from "./[id]/loading";

const SECTIONS = new Set<AssistantSectionLoadingVariant>([
  "preview",
  "general",
  "knowledge",
  "flows",
  "tools",
  "goals",
  "guardrails",
  "help-desks",
  "style",
  "authentication",
  "publish",
]);

/**
 * This segment's page only redirects to "/", so this boundary never stands in
 * for it. What it does wrap is `[id]/layout.tsx`, which awaits the Assistant
 * before any section's own loading.tsx can mount (loading.js wraps nested
 * layouts, not its own). So it draws the destination's skeleton, read from
 * the URL the router is heading to: a link from Alerts straight into an
 * Assistant's Flows would otherwise paint the Overview and then swap to the
 * Flows list.
 */
export default function AssistantsLoading() {
  const pathname = usePathname() ?? "";
  // /assistants/{id}/{section}/{...rest}
  const [, , , section, ...rest] = pathname.split("/");

  if (section === "flows" && rest.length > 0) return <FlowBuilderSkeleton />;
  if (section === "knowledge" && rest[0] === "imports") return <SourceDocumentsSkeleton />;
  if (section === "knowledge" && rest.length === 2) return <DocumentSkeleton />;
  if (section === "knowledge" && rest.length > 0) return <SourceDocumentsSkeleton />;
  if (section && SECTIONS.has(section as AssistantSectionLoadingVariant)) {
    return <AssistantSectionLoading variant={section as AssistantSectionLoadingVariant} />;
  }
  return <AssistantOverviewLoading />;
}
