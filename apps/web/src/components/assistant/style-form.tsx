"use client";

import { useState, useTransition } from "react";
import type { Assistant } from "@agent-hub/core";
import { toast } from "@/lib/toast";
import { updateAssistantAction } from "@/app/actions";
import { Button } from "@agent-hub/ui";
import { Card } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-hub/ui";
import { ColorPicker } from "@/components/ui/color-picker";

const DEFAULT_BRAND = "#0a0a0a";

export function StyleForm({
  assistant,
  canEdit,
}: {
  assistant: Assistant;
  canEdit: boolean;
}) {
  const [brandColor, setBrandColor] = useState(
    assistant.style?.brandColor ?? DEFAULT_BRAND
  );
  const [position, setPosition] = useState<"right" | "left">(
    assistant.style?.position ?? "right"
  );
  const [isPending, startTransition] = useTransition();

  const dirty =
    brandColor !== (assistant.style?.brandColor ?? DEFAULT_BRAND) ||
    position !== (assistant.style?.position ?? "right");

  function save() {
    startTransition(async () => {
      await updateAssistantAction(assistant.id, {
        style: { brandColor, position },
      });
      toast.success("Widget style saved — publish to make it live");
    });
  }

  return (
    <Card size="sm" className="gap-0 p-4">
      <h2 className="text-base font-semibold">Widget style</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Minimal branding for the floating launcher and chat.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-6">
        <div className="space-y-2">
          <Label>Brand color</Label>
          <Popover>
            <PopoverTrigger
              disabled={!canEdit}
              className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                className="size-5 rounded-sm border"
                style={{ backgroundColor: brandColor }}
              />
              <code className="text-muted-foreground text-xs uppercase">
                {brandColor}
              </code>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-3">
              <ColorPicker value={brandColor} onChange={setBrandColor} />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-2">
          <Label htmlFor="position">Launcher position</Label>
          <Select
            value={position}
            onValueChange={(value) => setPosition(value as "right" | "left")}
            disabled={!canEdit}
          >
            <SelectTrigger id="position" size="sm">
              <SelectValue>
                {(v: "right" | "left") =>
                  v === "right" ? "Bottom right" : "Bottom left"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="right">Bottom right</SelectItem>
              <SelectItem value="left">Bottom left</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={save}
          disabled={isPending || !dirty || !canEdit}
          variant="outline"
        >
          Save
        </Button>
      </div>
    </Card>
  );
}
