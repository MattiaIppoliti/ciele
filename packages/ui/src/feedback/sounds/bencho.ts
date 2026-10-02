import type { CueOptions, Interaction } from "../policy";

/** Tone parameters from the public Bencho sound catalogue (2026-10-01).
 * https://bencho.dev/sounds — preserve its frequencies, envelopes and filters.
 * Only the sounds the admin uses are kept; no recordings or remote requests.
 */
interface Voice {
  hz: number;
  to?: number;
  ms: number;
  gain: number;
  wave: OscillatorType;
  cut?: number;
  atk?: number;
  at?: number;
}

export const BENCHO_SOUNDS = {
  buzz: [
    {
      hz: 344,
      to: 239,
      ms: 24,
      gain: 0.048,
      wave: "triangle",
      cut: 1100,
      atk: 7,
    }
  ],
  check: [
    {
      hz: 370,
      ms: 90,
      gain: 0.055,
      wave: "square",
      cut: 2400,
      atk: 10,
    }
  ],
  chime: [
    {
      hz: 220,
      ms: 271,
      gain: 0.046,
      wave: "sine",
      cut: 820,
      atk: 90,
    }
  ],
  click: [
    {
      hz: 196,
      to: 130,
      ms: 150,
      gain: 0.07,
      wave: "sine",
      cut: 900,
    }
  ],
  cross: [
    {
      hz: 155,
      to: 78,
      ms: 235,
      gain: 0.059,
      wave: "sine",
      cut: 820,
      atk: 14,
    }
  ],
  deny: [
    {
      hz: 208,
      to: 165,
      ms: 120,
      gain: 0.03,
      wave: "sine",
      cut: 520,
      atk: 10,
    }
  ],
  expand: [
    {
      hz: 196,
      to: 174,
      ms: 360,
      gain: 0.042,
      wave: "sine",
      cut: 880,
      atk: 36,
    },
    {
      hz: 294,
      to: 262,
      ms: 300,
      gain: 0.014,
      wave: "sine",
      cut: 1100,
      atk: 48,
      at: 24,
    }
  ],
  flick: [
    {
      hz: 333,
      ms: 25,
      gain: 0.045,
      wave: "triangle",
      cut: 1100,
      atk: 9,
    }
  ],
  glide: [
    {
      hz: 397,
      to: 276,
      ms: 205,
      gain: 0.065,
      wave: "sine",
      cut: 820,
      atk: 90,
    }
  ],
  land: [
    {
      hz: 262,
      to: 247,
      ms: 320,
      gain: 0.036,
      wave: "sine",
      cut: 920,
      atk: 30,
    }
  ],
  mark: [
    {
      hz: 280,
      ms: 20,
      gain: 0.035,
      wave: "square",
      cut: 2400,
      atk: 6,
    }
  ],
  notch: [
    {
      hz: 230,
      ms: 49,
      gain: 0.048,
      wave: "sine",
      cut: 820,
      atk: 6,
    }
  ],
  off: [
    {
      hz: 330,
      to: 247,
      ms: 88,
      gain: 0.03,
      wave: "sine",
      cut: 720,
      atk: 8,
    }
  ],
  perk: [
    {
      hz: 330,
      ms: 360,
      gain: 0.053,
      wave: "sine",
      cut: 560,
      atk: 90,
    }
  ],
  pick: [
    {
      hz: 245,
      ms: 41,
      gain: 0.044,
      wave: "square",
      cut: 2400,
      atk: 6,
    }
  ],
  press: [
    {
      hz: 168,
      ms: 95,
      gain: 0.028,
      wave: "sine",
      cut: 480,
      atk: 14,
    }
  ],
  sweep: [
    {
      hz: 256,
      to: 230,
      ms: 263,
      gain: 0.055,
      wave: "square",
      cut: 2400,
      atk: 6,
    }
  ],
  thump: [
    {
      hz: 253,
      ms: 20,
      gain: 0.028,
      wave: "triangle",
      cut: 1700,
      atk: 6,
    }
  ],
} as const satisfies Record<string, readonly Voice[]>;

export type BenchoSound = keyof typeof BENCHO_SOUNDS;

/** Every admin interaction uses this identity, including chat and pointer release. */
export const BENCHO_CUES = {
  press: "press",
  release: "thump",
  tap: "press",
  on: "check",
  off: "off",
  switch: "pick",
  sweep: "sweep",
  copy: "glide",
  tick: "notch",
  click: "click",
  open: "expand",
  close: "cross",
  success: "land",
  error: "deny",
  warning: "buzz",
  arrive: "chime",
  send: "flick",
  reply: "perk",
  complete: "mark",
} as const satisfies Record<Interaction, BenchoSound>;

export interface BenchoPlayer {
  play(interaction: Interaction, options?: CueOptions): void;
  destroy(): void;
}

/** Constructed only after a gesture, never during a server import. */
export function createBenchoPlayer(allowed: () => boolean): BenchoPlayer {
  const audio = new AudioContext();
  const active = new Set<OscillatorNode>();
  const last = new Map<BenchoSound, number>();
  let destroyed = false;

  function schedule(interaction: Interaction, options?: CueOptions) {
    if (destroyed || !allowed() || audio.state !== "running") return;
    const sound = BENCHO_CUES[interaction];
    const now = audio.currentTime;
    // A label can activate its input too; one gesture must not double a cue.
    if (now - (last.get(sound) ?? -Infinity) < 0.06) return;
    last.set(sound, now);
    const pitch = 2 ** ((options?.pitch ?? 0) / 12);
    const volume = Math.max(0, Math.min(options?.volume ?? 1, 1));
    for (const voice of BENCHO_SOUNDS[sound] as readonly Voice[]) {
      const start = now + (voice.at ?? 0) / 1000;
      const duration = voice.ms / 1000;
      const end = start + duration;
      const attack = Math.min((voice.atk ?? 4) / 1000, duration * 0.6);
      const oscillator = audio.createOscillator();
      oscillator.type = voice.wave;
      oscillator.frequency.setValueAtTime(voice.hz * pitch, start);
      if (voice.to) oscillator.frequency.exponentialRampToValueAtTime(voice.to * pitch, end);
      const gain = audio.createGain();
      // Exponential ramps need a positive floor; it also avoids start/stop clicks.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, voice.gain * volume), start + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      const filter = voice.cut ? audio.createBiquadFilter() : null;
      if (filter) {
        filter.type = "lowpass";
        filter.frequency.value = voice.cut!;
        oscillator.connect(filter).connect(gain);
      } else oscillator.connect(gain);
      gain.connect(audio.destination);
      active.add(oscillator);
      oscillator.onended = () => {
        active.delete(oscillator);
        oscillator.disconnect();
        filter?.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    }
  }

  return {
    play(interaction, options) {
      if (destroyed || !allowed()) return;
      if (audio.state === "suspended") {
        void audio.resume().then(() => schedule(interaction, options)).catch(() => {});
      } else schedule(interaction, options);
    },
    destroy() {
      destroyed = true;
      for (const oscillator of active) oscillator.stop();
      active.clear();
      void audio.close().catch(() => {});
    },
  };
}
