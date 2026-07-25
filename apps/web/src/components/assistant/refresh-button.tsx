"use client";

import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { AnimatedIcon } from "@/components/ui/animated-icon";

export function RefreshButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      className="text-sm font-medium"
      onClick={() => router.refresh()}
    >
      <AnimatedIcon icon={RotateCw} size={16} />
      Refresh
    </Button>
  );
}
