"use client";

import { useEffect, useState } from "react";
import type { WaitingConversation } from "@ciele/ops";
import { Headphones } from "lucide-react";
import { RollInText } from "@/components/motion/roll-in-text";
import { listWaitingConversationsAction } from "@/app/(admin)/inbox/operator-actions";
import { waitedLabel } from "@/lib/inbox/waiting";

const REFRESH_MS = 10_000;

/**
 * The Waiting view (#1083): Visitors who asked for a person, oldest first,
 * with how long each has waited and the Help Desk it came from. Hidden while
 * nobody waits. Refreshes on its own, because a wait is minutes long.
 */
export function WaitingQueue({
  currentUserId,
  onSelect,
}: {
  currentUserId: string;
  onSelect: (conversationId: string) => void;
}) {
  const [rows, setRows] = useState<WaitingConversation[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const result = await listWaitingConversationsAction().catch(() => null);
      if (cancelled) return;
      if (result?.ok) setRows(result.value);
      setNow(Date.now());
      timer = setTimeout(load, REFRESH_MS);
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (rows.length === 0) return null;

  return (
    <section aria-label="Waiting for a person" className="border-b px-2 pb-2">
      <h3 className="flex items-center gap-2 px-2 py-2 text-sm font-semibold">
        <Headphones className="size-4 text-amber-600" aria-hidden />
        Waiting
        <span className="text-muted-foreground font-normal">
          <RollInText text={String(rows.length)} />
        </span>
      </h3>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.conversationId}>
            <button
              type="button"
              onClick={() => onSelect(row.conversationId)}
              className="press hover:bg-muted w-full rounded-lg px-2 py-1.5 text-left text-sm"
            >
              <span className="block truncate font-medium">{row.title || row.subjectId}</span>
              <span className="text-muted-foreground block truncate text-xs">
                <RollInText
                  text={[
                    waitedLabel(Math.max(row.waitedMs, now - Date.parse(row.waitingSince))),
                    row.helpDeskName,
                    row.assignedMemberId === currentUserId ? "Assigned to you" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
