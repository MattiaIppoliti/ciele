"use client";

import { useEffect, useState } from "react";
import type { EscalationHelpDesk } from "@/lib/escalation-desks";

/**
 * The Assistant's help desks, fetched the first time a Visitor types `@`.
 *
 * Lazily, and only once, for the same reason the escalation panel fetches them
 * lazily: most conversations never escalate, and the widget's whole design is
 * to cost a host page as little as possible until someone actually needs
 * something. A Visitor who never types `@` and never opens support never pays
 * for this request.
 *
 * A failed fetch yields an empty list, which opens no picker. `@` then stays
 * what it has always been in a chat message: a character.
 */
export function useHelpDesks(assistantId: string, wanted: boolean) {
  const [desks, setDesks] = useState<EscalationHelpDesk[]>([]);

  useEffect(() => {
    if (!wanted) return;
    let live = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/widget/${assistantId}/help-desks`,
          { signal: controller.signal }
        );
        if (!response.ok) return;
        const body = (await response.json()) as {
          helpDesks?: EscalationHelpDesk[];
        };
        // A desk with no enabled channel is a dead end: picking it opens a
        // panel with nothing in it. It stays out of the picker rather than
        // being offered and apologised for.
        if (live && Array.isArray(body.helpDesks)) {
          setDesks(body.helpDesks.filter((desk) => desk.channels.length > 0));
        }
      } catch {
        // Offline or aborted. No picker is a complete answer.
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [assistantId, wanted]);

  return desks;
}
