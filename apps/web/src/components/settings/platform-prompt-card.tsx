"use client";

import { useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "@/lib/toast";
import { updatePlatformPromptAction } from "@/app/actions";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Card } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";

/**
 * The Ciele platform system prompt editor. Rendered ONLY for the platform
 * owner (isPlatformOwner) — organizations never see this card. Every chat
 * turn on every assistant composes this prompt above the org's answering
 * style; leaving it empty falls back to the shipped default.
 */
export function PlatformPromptCard({
  storedPrompt,
  defaultPrompt,
}: {
  storedPrompt: string;
  defaultPrompt: string;
}) {
  const [value, setValue] = useState(storedPrompt);
  const [isPending, startTransition] = useTransition();
  const dirty = value !== storedPrompt;

  function save() {
    startTransition(async () => {
      try {
        await updatePlatformPromptAction(value);
        toast.success("Platform prompt saved");
      } catch {
        toast.error("Could not save the platform prompt");
      }
    });
  }

  return (
    <Card size="sm" className="mt-10 gap-0 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <AnimatedIcon icon={ShieldCheck} size={16} />
            Platform system prompt
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            The immutable Ciele layer applied to every assistant of every
            organization, above their own answering style. Only you can see
            and edit this. Leave empty to use the built-in default shown as
            placeholder.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 rounded-full">
          Owner only
        </Badge>
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={defaultPrompt}
        rows={12}
        className="mt-4 resize-y font-mono text-xs"
      />
      <div className="mt-3 flex items-center justify-end gap-3">
        {dirty && (
          <span className="text-muted-foreground text-sm">Unsaved changes</span>
        )}
        <Button onClick={save} disabled={isPending || !dirty}>
          {isPending ? "Saving..." : "Save platform prompt"}
        </Button>
      </div>
    </Card>
  );
}
