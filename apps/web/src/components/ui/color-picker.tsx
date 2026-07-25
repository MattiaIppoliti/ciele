"use client";

import { Pipette } from "lucide-react";
import { type HTMLAttributes, useMemo, useState } from "react";
import { Button } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { cn } from "@/lib/utils";

/**
 * Self-contained HSV color picker in the shadcn style (saturation/value square
 * + hue bar + hex field + eyedropper). Deliberately dependency-free: the repo
 * ships neither the `color` package nor a slider primitive, so conversions and
 * drag handling live here. Controlled by a hex string — alpha is out of scope
 * because the widget's brand color is stored as a plain hex.
 */

type Hsv = { h: number; s: number; v: number };

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h, s, v };
}

function hsvToHex(hsv: Hsv): string {
  const [r, g, b] = hsvToRgb(hsv);
  return (
    "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")
  ).toUpperCase();
}

/** Accepts #rgb / #rrggbb (with or without leading #); returns null if invalid. */
function hexToHsv(hex: string): Hsv | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return rgbToHsv(r, g, b);
}

export type ColorPickerProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange"
> & {
  value: string;
  onChange: (hex: string) => void;
};

export function ColorPicker({
  value,
  onChange,
  className,
  ...props
}: ColorPickerProps) {
  // HSV is the interaction source of truth so hue/saturation survive round-trips
  // through an achromatic hex (e.g. black keeping its hue). We resync it during
  // render when the controlled `value` moves to a color we didn't just emit —
  // React's supported "adjust state on prop change" pattern, no effect needed.
  const [hsv, setHsv] = useState<Hsv>(
    () => hexToHsv(value) ?? { h: 0, s: 0, v: 4 },
  );
  const [lastValue, setLastValue] = useState(value);
  const [hexDraft, setHexDraft] = useState(value.toUpperCase());

  if (value !== lastValue) {
    setLastValue(value);
    const next = hexToHsv(value);
    if (next && hsvToHex(next) !== hsvToHex(hsv)) {
      setHsv(next);
      setHexDraft(value.toUpperCase());
    }
  }

  const currentHex = hsvToHex(hsv);

  const commit = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setHexDraft(hex);
    onChange(hex);
  };

  return (
    <div className={cn("flex w-56 flex-col gap-3", className)} {...props}>
      <Saturation hsv={hsv} onChange={commit} />
      <Hue hue={hsv.h} onChange={(h) => commit({ ...hsv, h })} />
      <div className="flex items-center gap-2">
        <EyeDropperButton onPick={(hex) => commit(hexToHsv(hex) ?? hsv)} />
        <div
          className="size-8 shrink-0 rounded-md border"
          style={{ backgroundColor: currentHex }}
          aria-hidden
        />
        <Input
          aria-label="Hex color"
          value={hexDraft}
          spellCheck={false}
          className="h-8 font-mono text-xs uppercase"
          onChange={(e) => {
            const raw = e.target.value;
            setHexDraft(raw);
            const parsed = hexToHsv(raw);
            if (parsed) {
              setHsv(parsed);
              onChange(hsvToHex(parsed));
            }
          }}
          onBlur={() => setHexDraft(currentHex)}
        />
      </div>
    </div>
  );
}

/** Normalized [0,1] pointer position within the target element. */
function normalize(e: React.PointerEvent): { x: number; y: number } {
  const rect = e.currentTarget.getBoundingClientRect();
  return {
    x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
  };
}

/**
 * Pointer-drag handlers for a 2D/1D control. Pointer capture keeps move/up
 * firing on the element even when the cursor leaves it — no window listeners,
 * no refs, so it stays clear of the render-phase hook rules.
 */
function usePointerArea(handle: (x: number, y: number) => void) {
  const [active, setActive] = useState(false);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setActive(true);
      const { x, y } = normalize(e);
      handle(x, y);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!active) return;
      const { x, y } = normalize(e);
      handle(x, y);
    },
    onPointerUp: (e: React.PointerEvent) => {
      setActive(false);
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
  };
}

function Saturation({
  hsv,
  onChange,
}: {
  hsv: Hsv;
  onChange: (hsv: Hsv) => void;
}) {
  const handlers = usePointerArea((x, y) =>
    onChange({ ...hsv, s: x * 100, v: (1 - y) * 100 }),
  );

  const background = useMemo(
    () =>
      `linear-gradient(to top, #000, transparent),
       linear-gradient(to right, #fff, transparent),
       hsl(${hsv.h}, 100%, 50%)`,
    [hsv.h],
  );

  return (
    <div
      {...handlers}
      className="relative h-36 w-full touch-none cursor-crosshair rounded-md border"
      style={{ background }}
    >
      <span
        className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
        style={{
          left: `${hsv.s}%`,
          top: `${100 - hsv.v}%`,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
        }}
      />
    </div>
  );
}

function Hue({
  hue,
  onChange,
}: {
  hue: number;
  onChange: (hue: number) => void;
}) {
  const handlers = usePointerArea((x) => onChange(x * 360));

  return (
    <div
      {...handlers}
      className="relative h-3 w-full touch-none cursor-ew-resize rounded-full"
      style={{
        background: "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
      }}
    >
      <span
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white"
        style={{
          left: `${(hue / 360) * 100}%`,
          boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
        }}
      />
    </div>
  );
}

function EyeDropperButton({ onPick }: { onPick: (hex: string) => void }) {
  const supported = typeof window !== "undefined" && "EyeDropper" in window;
  if (!supported) return null;

  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className="text-muted-foreground size-8 shrink-0"
      aria-label="Pick color from screen"
      onClick={async () => {
        try {
          // EyeDropper is not yet in the TS DOM lib.
          const dropper = new (
            window as unknown as {
              EyeDropper: new () => {
                open: () => Promise<{ sRGBHex: string }>;
              };
            }
          ).EyeDropper();
          const { sRGBHex } = await dropper.open();
          onPick(sRGBHex);
        } catch {
          // user cancelled — no-op
        }
      }}
    >
      <Pipette className="size-4" />
    </Button>
  );
}
