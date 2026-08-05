"use client";

import { useState, useTransition } from "react";
import { Gauge } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  updateCompostOptOutAction,
  updateOrgBudgetAction,
} from "@/app/actions";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { Button } from "@agent-hub/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/**
 * Daily AI budget (AI usage ledger spec): admins set a per-org daily token
 * limit and/or euro limit — either one crossing today's usage raises an
 * auto-resolving Alert at the line (notify) or pauses AI answers (block).
 * The euro figure is an estimate from packages/db/src/pricing.ts, not a
 * billed amount. Null limit = unmetered. The weekly self-improvement
 * (compost) opt-out lives alongside it — both bound how much autonomous AI
 * work runs for the org.
 */
export function BudgetCard({
  dailyTokenLimit,
  dailyEuroLimit,
  enforcement,
  usedToday,
  usedTodayEur,
  compostOptOut,
  canManage,
}: {
  dailyTokenLimit: number | null;
  dailyEuroLimit: number | null;
  enforcement: "notify" | "block";
  usedToday: number;
  usedTodayEur: number;
  compostOptOut: boolean;
  canManage: boolean;
}) {
  const [limit, setLimit] = useState(
    dailyTokenLimit == null ? "" : String(dailyTokenLimit)
  );
  const [euroLimit, setEuroLimit] = useState(
    dailyEuroLimit == null ? "" : String(dailyEuroLimit)
  );
  const [mode, setMode] = useState<"notify" | "block">(enforcement);
  const [compostOn, setCompostOn] = useState(!compostOptOut);
  const [isCompostPending, startCompostTransition] = useTransition();
  const [isPending, startTransition] = useTransition();
  const dirty =
    limit !== (dailyTokenLimit == null ? "" : String(dailyTokenLimit)) ||
    euroLimit !== (dailyEuroLimit == null ? "" : String(dailyEuroLimit)) ||
    mode !== enforcement;

  function toggleCompost(next: boolean) {
    setCompostOn(next);
    startCompostTransition(async () => {
      try {
        await updateCompostOptOutAction(!next);
        toast.success(
          next ? "Weekly improvement suggestions on" : "Weekly improvement suggestions off"
        );
      } catch {
        setCompostOn(!next);
        toast.error("Could not update the setting");
      }
    });
  }

  function save() {
    const parsed = limit.trim() === "" ? null : Number(limit);
    if (parsed != null && (!Number.isFinite(parsed) || parsed <= 0)) {
      toast.error("The daily token limit must be a positive number");
      return;
    }
    const parsedEuro = euroLimit.trim() === "" ? null : Number(euroLimit);
    if (parsedEuro != null && (!Number.isFinite(parsedEuro) || parsedEuro <= 0)) {
      toast.error("The daily euro limit must be a positive number");
      return;
    }
    startTransition(async () => {
      try {
        await updateOrgBudgetAction({
          dailyTokenLimit: parsed,
          dailyEuroLimit: parsedEuro,
          enforcement: mode,
        });
        toast.success("Budget saved");
      } catch {
        toast.error("Could not save the budget");
      }
    });
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AnimatedIcon icon={Gauge} size={18} />
          Daily AI budget
        </CardTitle>
        <CardDescription>
          Cap how many model tokens and/or estimated euros your assistants may
          use per day (UTC), either limit crossing today&apos;s usage
          triggers enforcement. Used today: {usedToday.toLocaleString("en-US")}{" "}
          tokens (~€{usedTodayEur.toFixed(2)}). Leave a limit empty for
          unmetered usage on that dimension.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="budget-limit">Daily token limit</Label>
          <Input
            id="budget-limit"
            className="w-44"
            inputMode="numeric"
            placeholder="Unmetered"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            disabled={!canManage || isPending}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="budget-euro-limit">Daily euro limit</Label>
          <Input
            id="budget-euro-limit"
            className="w-44"
            inputMode="decimal"
            placeholder="Unmetered"
            value={euroLimit}
            onChange={(e) => setEuroLimit(e.target.value)}
            disabled={!canManage || isPending}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>At the limit</Label>
          <Select
            value={mode}
            onValueChange={(v) => setMode(v === "block" ? "block" : "notify")}
            disabled={!canManage || isPending}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="notify">Notify only (raise an alert)</SelectItem>
              <SelectItem value="block">Pause AI answers</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button onClick={save} disabled={!dirty || isPending}>
            {isPending ? "Saving…" : "Save budget"}
          </Button>
        )}
      </CardContent>
      <CardContent className="border-t pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor="compost-toggle" className="text-sm font-medium">
              Weekly improvement suggestions
            </Label>
            <p className="text-muted-foreground text-sm">
              Once a week, review the past week&apos;s answers and file up to three
              suggested improvements for your team to consider. Nothing is applied
              automatically. Turn this off to skip the weekly pass entirely.
            </p>
          </div>
          <Switch
            id="compost-toggle"
            checked={compostOn}
            onCheckedChange={toggleCompost}
            disabled={!canManage || isCompostPending}
            aria-label="Weekly improvement suggestions"
          />
        </div>
      </CardContent>
    </Card>
  );
}
