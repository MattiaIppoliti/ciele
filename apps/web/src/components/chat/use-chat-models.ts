"use client";

import { useEffect, useState } from "react";
import type { ChatModelOption } from "@agent-hub/agent/client";

/**
 * The widget's model picker rows, fetched once when the Assistant opened the
 * choice and never otherwise.
 *
 * The rows cannot ride the Publication snapshot: they depend on which Provider
 * Connections the Organization holds *now*, and the widget page is deliberately
 * static per Publication (see `app/widget/[assistantId]/page.tsx`). So the
 * snapshot answers the cheap question, "is there a choice at all", and only an
 * Assistant that said yes pays for the round trip. The config route is cached
 * `public, max-age=300`, and the launcher usually fetched it already, so in
 * practice this is a browser-cache read.
 *
 * A failed fetch yields an empty list, which draws no picker and runs the
 * configured model. The one thing that must never happen is a Visitor losing
 * their conversation because a picker could not be drawn.
 */
export function useChatModels(
  assistantId: string,
  enabled: boolean
): ChatModelOption[] {
  const [models, setModels] = useState<ChatModelOption[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/widget/${assistantId}/config`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const config = (await response.json()) as {
          models?: ChatModelOption[];
        };
        if (live && Array.isArray(config.models)) setModels(config.models);
      } catch {
        // Offline, aborted, or a config route that does not serve models yet.
        // No picker is a complete answer.
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [assistantId, enabled]);

  return models;
}

/** The `models` rows `PromptInput` renders, from the runtime's option shape. */
export function toPromptModels(
  options: ChatModelOption[]
): Array<{ value: string; label: string }> {
  return options.map((option) => ({
    value: option.selector,
    label: option.label,
  }));
}
