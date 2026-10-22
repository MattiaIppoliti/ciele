"use client";

import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { EmptyState } from "@/components/ui/empty-state";
import { PageCrumb } from "@/components/shell/top-bar-slots";

/**
 * A record that does not exist, or that this Member cannot read, inside the
 * console (#1073). The root 404 is the marketing page and replaces the whole
 * shell; a `notFound()` from a console page lands here instead, so the sidebar,
 * Find and the way back stay where they were.
 */
export default function AdminNotFound() {
  return (
    <div className="flex h-full min-h-0 flex-col p-4 @xl:p-6">
      <PageCrumb label="Not found" />
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        className="flex-1"
        icon={<SearchX aria-hidden className="size-5" />}
        title="Page not found"
        description="It was deleted, moved, or you do not have access to it."
      >
        <Button nativeButton={false} render={<Link href="/" />}>Go to Assistants</Button>
      </EmptyState>
    </div>
  );
}
