"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, Label } from "@agent-hub/ui";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { setNotificationPreferencesAction } from "@/app/work-actions";

type Preferences = { emailAssigned: boolean; emailMentioned: boolean };

const ROWS: { key: keyof Preferences; label: string; hint: string }[] = [
  {
    key: "emailAssigned",
    label: "Email me when a task is assigned to me",
    hint: "Someone else gives you a task in a project you can see.",
  },
  {
    key: "emailMentioned",
    label: "Email me when I'm mentioned",
    hint: "Someone names you in a comment or a task description.",
  },
];

/** The two email switches (#1048): both on by default, each the Member's own. */
export function NotificationPreferencesClient({ initial }: { initial: Preferences }) {
  const [prefs, setPrefs] = useState(initial);
  const [pending, startTransition] = useTransition();

  const toggle = (key: keyof Preferences, on: boolean) => {
    const before = prefs;
    setPrefs({ ...prefs, [key]: on });
    startTransition(async () => {
      const result = await setNotificationPreferencesAction({ [key]: on });
      if (!result.ok) {
        setPrefs(before);
        return toast.error(result.error);
      }
      setPrefs(result.value);
      toast.success("Saved");
    });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor={`pref-${row.key}`} className="text-sm font-medium">
                {row.label}
              </Label>
              <p className="text-muted-foreground text-sm">{row.hint}</p>
            </div>
            <Switch
              id={`pref-${row.key}`}
              checked={prefs[row.key]}
              disabled={pending}
              onCheckedChange={(on) => toggle(row.key, on)}
              aria-label={row.label}
            />
          </div>
        ))}
        <p className="text-muted-foreground border-alpha-medium border-t pt-4 text-xs">
          Every notification still appears on the Notifications page. Comments and status changes are never emailed.
        </p>
      </CardContent>
    </Card>
  );
}
