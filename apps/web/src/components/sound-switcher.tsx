"use client";

import { useFeedback } from "@agent-hub/ui/feedback";
import { Switch } from "@/components/ui/switch";

/**
 * The one control interface sounds have (#817): on or off, per device, beside
 * the theme in the account menu. Haptics are not on this switch; they follow
 * the OS reduced-motion setting, which people already set for exactly this.
 *
 * Unmuting sounds the switch's own `on` cue, which doubles as the preview.
 */
export function SoundSwitcher() {
  const { muted, setMuted } = useFeedback();
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-1.5">
      <label htmlFor="sound-switch" className="text-sm">
        Sounds
      </label>
      <Switch
        id="sound-switch"
        size="sm"
        checked={!muted}
        onCheckedChange={(checked) => setMuted(!checked)}
        aria-label="Interface sounds"
      />
    </div>
  );
}
