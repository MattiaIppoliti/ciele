"use client";

import { Pipette } from "lucide-react";
import { type HTMLAttributes, useMemo, useState } from "react";
import { Button } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COLOR_FORMATS,
  type ColorFormat,
  type Hsv,
  formatColor,
  hexToHsv,
  hsvToHex,
} from "@/lib/color";
import { cn } from "@/lib/utils";

/**
 * Self-contained HSV color picker in the shadcn style: saturation/value square
 * + hue bar + alpha bar + an output-format switch (HEX/RGB/CSS/HSL) and an
 * eyedropper. Dependency-free by design, the repo ships neither the `color`
 * package nor a slider primitive, so the conversions live in `@/lib/color` (the
 * testable layer) and drag handling lives here.
 *
 * Controlled by a hex string: `#RRGGBB` while opaque, `#RRGGBBAA` once alpha
 * drops below 100, so an opaque brand color round-trips through storage
 * unchanged. Pass `alpha={false}` where translucency makes no sense.
 */

export type ColorPickerProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange"
> & {
  value: string;
  onChange: (hex: string) => void;
  /** Show the alpha slider and the alpha column of the format row. */
  alpha?: boolean;
};

export function ColorPicker({
  value,
  onChange,
  alpha = true,
  className,
  ...props
}: ColorPickerProps) {
  // HSV is the interaction source of truth so hue/saturation survive round-trips
  // through an achromatic hex (e.g. black keeping its hue). We resync it during
  // render when the controlled `value` moves to a color we didn't just emit,
  // React's supported "adjust state on prop change" pattern, no effect needed.
  const [hsv, setHsv] = useState<Hsv>(
    () => hexToHsv(value) ?? { h: 0, s: 0, v: 4, a: 100 },
  );
  const [lastValue, setLastValue] = useState(value);
  const [hexDraft, setHexDraft] = useState(value.toUpperCase());
  const [format, setFormat] = useState<ColorFormat>("hex");

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
    <div className={cn("flex w-60 flex-col gap-3", className)} {...props}>
      <Saturation hsv={hsv} onChange={commit} />
      <Hue hue={hsv.h} onChange={(h) => commit({ ...hsv, h })} />
      {alpha ? (
        <Alpha hsv={hsv} onChange={(a) => commit({ ...hsv, a })} />
      ) : null}

      <div className="flex items-center gap-2">
        <EyeDropperButton
          onPick={(hex) => commit({ ...(hexToHsv(hex) ?? hsv), a: hsv.a })}
        />
        <span
          className="size-8 shrink-0 rounded-md border bg-[repeating-conic-gradient(#d4d4d4_0_25%,transparent_0_50%)] bg-[length:8px_8px]"
          aria-hidden
        >
          <span
            className="block size-full rounded-md"
            style={{ backgroundColor: currentHex }}
          />
        </span>
        <Select
          value={format}
          onValueChange={(next) => setFormat(next as ColorFormat)}
        >
          <SelectTrigger
            size="sm"
            aria-label="Output format"
            className="h-8 w-[4.5rem] shrink-0 px-2 text-xs"
          >
            <SelectValue>
              {(v: ColorFormat) => v.toUpperCase()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {COLOR_FORMATS.map((f) => (
              <SelectItem key={f} value={f} className="text-xs">
                {f.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        {format === "hex" ? (
          // Hex stays editable, it is the value we store, so typing one in is
          // the fast path. The derived formats are read-only mirrors.
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
        ) : (
          <Input
            aria-label={`${format.toUpperCase()} color`}
            readOnly
            value={formatColor(hsv, format)}
            className="h-8 font-mono text-xs"
          />
        )}
        {alpha && format !== "css" ? (
          <div className="relative shrink-0">
            <Input
              aria-label="Alpha"
              readOnly
              value={Math.round(hsv.a)}
              className="h-8 w-14 pr-5 font-mono text-xs"
            />
            <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs">
              %
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Normalized [0,1] pointer position within the target element. */
function normalize(e: React.PointerEvent): { x: number; y: number } {
  const rect = e.currentTarget.getBoundingClientRect();
  return {
    x: clamp01((e.clientX - rect.left) / rect.width),
    y: clamp01((e.clientY - rect.top) / rect.height),
  };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Pointer-drag handlers for a 2D/1D control. Pointer capture keeps move/up
 * firing on the element even when the cursor leaves it, no window listeners,
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
      <Thumb left={(hue / 360) * 100} />
    </div>
  );
}

function Alpha({ hsv, onChange }: { hsv: Hsv; onChange: (a: number) => void }) {
  const handlers = usePointerArea((x) => onChange(Math.round(x * 100)));
  const opaque = hsvToHex({ ...hsv, a: 100 });

  return (
    <div
      {...handlers}
      className="relative h-3 w-full touch-none cursor-ew-resize rounded-full bg-[repeating-conic-gradient(#d4d4d4_0_25%,transparent_0_50%)] bg-[length:8px_8px]"
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${opaque})`,
        }}
      />
      <Thumb left={hsv.a} />
    </div>
  );
}

function Thumb({ left }: { left: number }) {
  return (
    <span
      className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white"
      style={{ left: `${left}%`, boxShadow: "0 0 0 1px rgba(0,0,0,0.4)" }}
    />
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
          // user cancelled, no-op
        }
      }}
    >
      <Pipette className="size-4" />
    </Button>
  );
}
