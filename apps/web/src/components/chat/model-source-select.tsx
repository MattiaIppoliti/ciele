"use client";

import type { ModelSource } from "@agent-hub/core";
import { MODEL_SOURCE_NAMES } from "@agent-hub/agent/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const AUTOMATIC = "automatic";

/**
 * Which credential the configured model runs on: Automatic (the order the
 * runtime always used) or one source, tagged. Shown only when there is a real
 * choice, two or more sources for this model, or when a pinned source is
 * stored and has to stay reachable to be cleared.
 */
export function ModelSourceSelect({
  sources,
  value,
  onChange,
  disabled = false,
}: {
  /** The sources that can serve the selected model now (`availableModelSources`). */
  sources: ModelSource[];
  value: ModelSource | null;
  onChange: (next: ModelSource | null) => void;
  disabled?: boolean;
}) {
  if (sources.length < 2 && value === null) return null;
  const options = value && !sources.includes(value) ? [...sources, value] : sources;
  return (
    <Select
      value={value ?? AUTOMATIC}
      disabled={disabled}
      onValueChange={(next) =>
        onChange(next === AUTOMATIC ? null : (next as ModelSource))
      }
      className="w-48"
    >
      <SelectTrigger className="h-11" aria-label="Model source">
        <SelectValue>{value ? MODEL_SOURCE_NAMES[value] : "Automatic"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTOMATIC}>Automatic</SelectItem>
        {options.map((source) => (
          <SelectItem key={source} value={source}>
            {MODEL_SOURCE_NAMES[source]}
            {!sources.includes(source) && (
              <span className="text-muted-foreground ml-auto text-xs">unavailable</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
