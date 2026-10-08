"use client";

import { useSyncExternalStore } from "react";
import type { KeyboardEvent } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { SectionTimeline, TimelineSection } from "@/components/settings/section-timeline";
import { useTheme } from "@/components/theme-provider";

const NOOP_SUBSCRIBE = () => () => {};

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

const PALETTE_OPTIONS = [
  {
    value: "midnight",
    label: "Midnight",
    colors: ["#121212", "#191919"],
  },
  {
    value: "mist-blue",
    label: "Mist Blue",
    colors: ["#151B23", "#202830"],
  },
] as const;

function handleRadioKeyDown<T extends string>(
  event: KeyboardEvent<HTMLDivElement>,
  options: readonly { value: T }[],
  selected: T,
  onSelect: (value: T) => void,
) {
  const key = event.key;
  if (
    key !== "ArrowRight" &&
    key !== "ArrowDown" &&
    key !== "ArrowLeft" &&
    key !== "ArrowUp" &&
    key !== "Home" &&
    key !== "End"
  ) return;

  event.preventDefault();
  const values = options.map((option) => option.value);
  const currentIndex = values.indexOf(selected);
  const nextIndex = key === "Home"
    ? 0
    : key === "End"
      ? values.length - 1
      : (currentIndex + (key === "ArrowRight" || key === "ArrowDown" ? 1 : -1) + values.length) % values.length;
  const nextValue = values[nextIndex];
  if (nextValue === undefined) return;
  event.currentTarget
    .querySelector<HTMLButtonElement>(`[data-radio-value="${nextValue}"]`)
    ?.focus();
  onSelect(nextValue);
}

export function ThemeSettingsClient() {
  const { theme, setTheme, colorPalette, setColorPalette } = useTheme();
  const hydrated = useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => true,
    () => false,
  );
  const selectedTheme = hydrated ? theme : "system";
  const selectedPalette = hydrated ? colorPalette : "midnight";

  return (
    <div className="mt-6">
      <SectionTimeline>
      <TimelineSection title="Theme mode" boxed>

          <div
            className="grid gap-2 @xl/settings:grid-cols-3"
            role="radiogroup"
            aria-label="Theme mode"
            onKeyDown={(event) =>
              handleRadioKeyDown(event, THEME_OPTIONS, selectedTheme, setTheme)
            }
          >
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
              const selected = selectedTheme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={label}
                  data-radio-value={value}
                  tabIndex={selected ? 0 : -1}
                  data-foley-toggle="switch"
                  onClick={() => setTheme(value)}
                  className={`relative flex min-h-24 flex-col items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/60"
                  }`}
                >
                  <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {label}
                      {selected && <Check className="size-3.5" aria-hidden="true" />}
                    </span>

                  </span>
                </button>
              );
            })}
          </div>
        </TimelineSection>

      <TimelineSection title="Color palette" boxed>

          <div
            className="grid gap-2 @md/settings:grid-cols-2"
            role="radiogroup"
            aria-label="Color palette"
            onKeyDown={(event) =>
              handleRadioKeyDown(event, PALETTE_OPTIONS, selectedPalette, setColorPalette)
            }
          >
            {PALETTE_OPTIONS.map(({ value, label, colors }) => {
              const selected = selectedPalette === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={label}
                  data-radio-value={value}
                  tabIndex={selected ? 0 : -1}
                  data-foley-toggle="switch"
                  onClick={() => setColorPalette(value)}
                  className={`flex min-h-20 items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/60"
                  }`}
                >
                  <span className="flex shrink-0 gap-1" aria-hidden="true">
                    {colors.map((color) => (
                      <span
                        key={color}
                        className="size-7 rounded-full border border-white/15"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {label}
                      {selected && <Check className="size-3.5" aria-hidden="true" />}
                    </span>

                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            Appearance settings are saved in this browser.
          </p>
        </TimelineSection>
      </SectionTimeline>
    </div>
  );
}
