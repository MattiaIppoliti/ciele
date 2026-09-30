"use client";

import { useFeedback } from "@agent-hub/ui/feedback";
import { Switch } from "@/components/ui/motion-switch";
import { AnimatedGlyph } from "@/components/ui/animated-icon";
import { Volume2Icon } from "@/components/ui/icons/volume-2";

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
    // Matches the menu's items, as the theme row beside it does.
    <div data-animate-group className="flex items-center justify-between gap-3 px-3 py-2.5">
      <label htmlFor="sound-switch" className="flex items-center gap-3 text-base">
        <AnimatedGlyph icon={Volume2Icon} size={18} />
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
