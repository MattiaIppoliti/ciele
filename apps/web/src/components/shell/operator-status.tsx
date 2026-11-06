"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OperatorStatus } from "@agent-hub/core";
import { Button } from "@agent-hub/ui";
import { RollInText } from "@/components/motion/roll-in-text";
import { toast } from "@/lib/toast";
import {
  getOperatorStatusAction,
  renewOperatorPresenceAction,
  setOperatorStatusAction,
} from "@/app/(admin)/inbox/operator-actions";

/** Keep the Available lease alive while the authenticated console is open. */
const PRESENCE_HEARTBEAT_MS = 15_000;

/**
 * An operator's Available/Away switch in the console shell (#1084). Stored
 * server-side, so it survives a reload; signing out sets Away. Shown only to
 * Members who may answer Visitors. While Available it renews a short lease and refreshes durable assignment
 * notices on any console page.
 */
export function OperatorStatusToggle({ memberId }: { memberId: string }) {
  const router = useRouter();
  const seen = useRef(new Set<string>());
  const [status, setStatus] = useState<OperatorStatus | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void getOperatorStatusAction()
      .then((result) => {
        if (!cancelled && result.ok) setStatus(result.value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  // Durable assignment notices arrive through the Member notification inbox.
  // This heartbeat never revives an explicit Away status.
  useEffect(() => {
    if (status !== "available") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async () => {
      const presence = await renewOperatorPresenceAction().catch(() => null);
      if (cancelled) return;
      if (!presence?.ok) {
        setReconnecting(true);
        timer = setTimeout(check, PRESENCE_HEARTBEAT_MS);
        return;
      }
      setReconnecting(false);
      if (presence.value.status !== "available") { setStatus("away"); return; }
      if (presence.value.notificationIds) {
        if (presence.value.notificationIds.some(id => !seen.current.has(id))) router.refresh();
        seen.current = new Set(presence.value.notificationIds);
      }
      timer = setTimeout(check, PRESENCE_HEARTBEAT_MS);
    };
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [status, memberId, router]);

  if (!status) return null;
  const available = status === "available";

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={isPending}
      aria-pressed={available}
      title={available ? "You receive waiting Visitors. Select to go Away." : "Select to receive waiting Visitors."}
      onClick={() =>
        startTransition(async () => {
          const next: OperatorStatus = available ? "away" : "available";
          const result = await setOperatorStatusAction(next);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          setReconnecting(false);
          setStatus(result.value);
        })
      }
    >
      <span
        aria-hidden
        className={`size-2 rounded-full ${available ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
      />
      <RollInText text={reconnecting ? "Reconnecting…" : available ? "Available" : "Away"} />
    </Button>
  );
}
