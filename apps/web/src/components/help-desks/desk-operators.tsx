"use client";

import { useState, useTransition } from "react";
import { Button, Input } from "@agent-hub/ui";
import { Switch } from "@/components/ui/motion-switch";
import { DEFAULT_OPERATOR_CAPACITY } from "@agent-hub/core";
import { toast } from "@/lib/toast";
import { setHelpDeskOperatorsAction } from "@/app/(admin)/inbox/operator-actions";

interface OperatorRow {
  memberId: string;
  capacity: number;
}

/**
 * Who staffs this desk's Live operator channel (#1084), and how many
 * Conversations each holds at once. A waiting Visitor goes to the
 * least-loaded Available operator; the channel is offered only while one of
 * them is Available.
 */
export function DeskOperators({
  helpDeskId,
  members,
  operators,
  canEdit,
}: {
  helpDeskId: string;
  members: Array<{ userId: string; name: string }>;
  operators: OperatorRow[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<Map<string, number>>(
    () => new Map(operators.map((row) => [row.memberId, row.capacity]))
  );
  const [isPending, startTransition] = useTransition();
  const initial = new Map(operators.map((row) => [row.memberId, row.capacity]));
  const dirty =
    rows.size !== initial.size || [...rows].some(([memberId, capacity]) => initial.get(memberId) !== capacity);

  function toggle(memberId: string, on: boolean) {
    setRows((current) => {
      const next = new Map(current);
      if (on) next.set(memberId, current.get(memberId) ?? DEFAULT_OPERATOR_CAPACITY);
      else next.delete(memberId);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await setHelpDeskOperatorsAction(
        helpDeskId,
        [...rows].map(([memberId, capacity]) => ({ memberId, capacity }))
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Operators saved");
    });
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card px-4 py-3.5">
      <p className="text-muted-foreground text-sm">
        Members who answer this desk&apos;s Live operator channel. Capacity is the most conversations
        an operator holds at once.
      </p>
      <ul className="divide-y">
        {members.map((member) => {
          const capacity = rows.get(member.userId);
          return (
            <li key={member.userId} className="flex items-center gap-3 py-2">
              <Switch
                checked={capacity !== undefined}
                disabled={!canEdit || isPending}
                aria-label={`${member.name} answers this desk`}
                onCheckedChange={(checked) => toggle(member.userId, checked)}
              />
              <span className="min-w-0 flex-1 truncate text-sm">{member.name}</span>
              {capacity !== undefined && (
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={String(capacity)}
                  disabled={!canEdit || isPending}
                  aria-label={`Capacity for ${member.name}`}
                  className="h-9 w-20"
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value, 10);
                    if (!Number.isNaN(value)) {
                      setRows((current) => new Map(current).set(member.userId, Math.min(50, Math.max(1, value))));
                    }
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="primary" size="sm" disabled={!dirty || isPending} onClick={save}>
            Save operators
          </Button>
        </div>
      )}
    </section>
  );
}
