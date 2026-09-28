// Vendored from EvilCharts, trimmed to what Ciele's callers use.
import type { ComponentType, ReactNode } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Theme keys, config and the `--color-{key}-{n}` CSS both chart engines share.
// No ECharts import here, so the Recharts pie chunk stays ECharts-free.
// ─────────────────────────────────────────────────────────────────────────────

// Theme selectors: light is the bare root, dark is `.dark`.
export const THEMES = { light: "", dark: ".dark" } as const;
export type ThemeKey = keyof typeof THEMES;
export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];

// Require at least one theme key.
export type AtLeastOneThemeColor =
  | { light: string[]; dark?: string[] }
  | { light?: string[]; dark: string[] };

export type ChartConfig = Record<
  string,
  {
    label?: ReactNode;
    icon?: ComponentType;
    colors?: AtLeastOneThemeColor;
  }
>;

// Max slots a key needs = longest color array across themes (min 1). Both themes
// always emit the same number of `--color-{key}-{n}` vars.
export function getColorsCount(item: ChartConfig[string]): number {
  if (!item.colors) return 1;
  const counts = THEME_KEYS.map((theme) => item.colors?.[theme]?.length ?? 0);
  return Math.max(...counts, 1);
}

// Distribute colors evenly across slots; extra slots go to the LAST color(s).
// 2 colors / 4 slots → [c0, c0, c1, c1]; 3 colors / 4 slots → [c0, c1, c2, c2].
function distributeColors(colors: string[], maxCount: number): string[] {
  const available = colors.length;
  if (available >= maxCount) return colors.slice(0, maxCount);

  const result: string[] = [];
  const baseSlots = Math.floor(maxCount / available);
  const extraSlots = maxCount % available;

  for (let i = 0; i < available; i++) {
    const isExtra = i >= available - extraSlots;
    const slots = baseSlots + (isExtra ? 1 : 0);
    for (let j = 0; j < slots; j++) result.push(colors[i]);
  }

  return result;
}

// `--color-{key}-{n}` scoped to `[data-chart={id}]` (light) and
// `.dark [data-chart={id}]` (dark). Empty when no entry carries colors.
export function buildChartCss(id: string, config: ChartConfig): string {
  const colorConfig = Object.entries(config).filter(([, item]) => item.colors);
  if (!colorConfig.length) return "";

  const varsFor = (theme: ThemeKey) =>
    colorConfig
      .flatMap(([key, item]) => {
        const authored = item.colors?.[theme];
        if (!authored || authored.length === 0) return [];
        return distributeColors(authored, getColorsCount(item)).map(
          (color, index) => `  --color-${key}-${index}: ${color};`,
        );
      })
      .join("\n");

  return Object.entries(THEMES)
    .map(([theme, prefix]) => `${prefix} [data-chart=${id}] {\n${varsFor(theme as ThemeKey)}\n}`)
    .join("\n");
}

// Solid var / gradient of vars for a series indicator. Used by the tooltip rows
// and the legend indicators of both engines.
export function indicatorBackground(key: string, colorsCount: number): string {
  if (colorsCount <= 1) return `var(--color-${key}-0)`;
  const stops = Array.from({ length: colorsCount }, (_, i) => {
    const offset = (i / (colorsCount - 1)) * 100;
    return `var(--color-${key}-${i}) ${offset}%`;
  }).join(", ");
  return `linear-gradient(to right, ${stops})`;
}
