"use client";

import { useFeedback } from "@agent-hub/ui/feedback";
import { AnimatedGlyph } from "@/components/ui/animated-icon";
import { Volume2Icon } from "@/components/ui/icons/volume-2";
import { VolumeIcon } from "@/components/ui/icons/volume";

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
      <span className="flex items-center gap-3 text-base">
        <AnimatedGlyph icon={Volume2Icon} size={18} />
        Sounds
      </span>
      <button
        type="button"
        aria-pressed={!muted}
        aria-label="Interface sounds"
        title={muted ? "Enable interface sounds" : "Mute interface sounds"}
        onClick={() => setMuted(!muted)}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") event.stopPropagation();
        }}
        data-foley-toggle="switch"
        className="press text-foreground hover:bg-muted focus-visible:outline-ring flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <VolumeIcon muted={muted} />
      </button>
    </div>
  );
}
