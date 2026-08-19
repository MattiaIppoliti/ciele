"use client";

import { useState, useTransition } from "react";
import { Brain } from "lucide-react";
import { toast } from "sonner";
import { updateMemoryEnabledAction } from "@/app/actions";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import { Switch } from "@/components/ui/switch";

/**
 * Org-level long-term memory toggle (#664), off by default. When on,
 * assistants remember durable facts about signed-in end-users across
 * conversations: a background job extracts them after a conversation goes
 * quiet, and the most relevant ones are recalled at the start of the user's
 * next conversation. Applies only to users signed in through the widget's
 * SSO gate: anonymous visitors are never remembered.
 */
export function MemoryCard({
  memoryEnabled,
  canManage,
}: {
  memoryEnabled: boolean;
  canManage: boolean;
}) {
  const [enabled, setEnabled] = useState(memoryEnabled);
  const [isPending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      try {
        await updateMemoryEnabledAction(next);
        toast.success(next ? "Long-term memory on" : "Long-term memory off");
      } catch {
        setEnabled(!next);
        toast.error("Could not update the setting");
      }
    });
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AnimatedIcon icon={Brain} size={18} />
          Long-term memory
        </CardTitle>
        <CardDescription>
          Let assistants remember durable facts about signed-in users across
          conversations, stated preferences, standing instructions, stable
          account facts. Only users signed in through the widget&apos;s SSO
          gate are remembered; anonymous visitors never are. Extraction runs
          in the background after a conversation ends and counts against the
          daily AI budget.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="memory-toggle" className="text-sm font-medium">
              Remember signed-in users across conversations
            </Label>
            <p className="text-muted-foreground text-sm">
              Off by default. While off, nothing is extracted and nothing is
              recalled.
            </p>
          </div>
          <Switch
            id="memory-toggle"
            checked={enabled}
            onCheckedChange={toggle}
            disabled={!canManage || isPending}
            aria-label="Long-term memory"
          />
        </div>
      </CardContent>
    </Card>
  );
}
