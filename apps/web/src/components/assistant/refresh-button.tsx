"use client";

import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { AnimatedIcon } from "@/components/ui/animated-icon";

export function RefreshButton({ onRefresh }: { onRefresh?: () => void }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      className="text-sm font-medium"
      onClick={() => {
        // router.refresh() re-fetches server data but keeps client state, so a
        // caller that also needs to restart its own state passes onRefresh.
        router.refresh();
        onRefresh?.();
      }}
    >
      <AnimatedIcon icon={RotateCw} size={16} />
      Refresh
    </Button>
  );
}
