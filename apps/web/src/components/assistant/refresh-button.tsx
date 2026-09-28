"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { RollInText } from "@/components/motion/roll-in-text";

export function RefreshButton({ onRefresh }: { onRefresh?: () => void }) {
  const router = useRouter();
  // A transition, so the button knows when the fresh server data has landed.
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      className="text-sm font-medium"
      disabled={pending}
      onClick={() => {
        // router.refresh() re-fetches server data but keeps client state, so a
        // caller that also needs to restart its own state passes onRefresh.
        startTransition(() => router.refresh());
        onRefresh?.();
      }}
    >
      <AnimatedIcon
        icon={RotateCw}
        size={16}
        className={pending ? "motion-safe:animate-spin" : undefined}
      />
      <RollInText text={pending ? "Refreshing…" : "Refresh"} />
    </Button>
  );
}
