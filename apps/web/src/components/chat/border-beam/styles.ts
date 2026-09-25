/**
 * Vendored from border-beam (MIT), by Jakub Antalik.
 * Upstream: Jakubantalik/Libraries.dev @ cb9e9b06c54bff3281abe4072a82d4b246dfd093
 * packages/border-beam/src/styles.ts
 *
 * Retains the original md / Rotate masks, gradients, timing and theme presets.
 * Unused size families and palettes are omitted. See LICENSE in this directory.
 */

type BorderBeamColorVariant = "colorful" | "mono";

interface GenerateStylesOptions {
  id: string;
  borderRadius: string;
  borderWidth: number;
  duration: number;
  strokeOpacity: number;
  innerOpacity: number;
  bloomOpacity: number;
  innerShadow: string;
  colorVariant: BorderBeamColorVariant;
  staticColors: boolean;
  brightness: number;
  saturation: number;
  hueRange: number;
  theme: "dark" | "light";
  glowSize?: number;
}

export function createBorderBeamStyles(id: string, theme: "dark" | "light") {
  const dark = theme === "dark";
  const monoIntensity = 2.75;
  return generateBorderVariantCSS({
    id,
    // PromptInput uses rounded-2xl, which resolves to this theme token.
    // Keep the beam rounded even when its CSS loads after the first layout.
    borderRadius: "calc(var(--radius) * 1.8)",
    borderWidth: 1,
    duration: 1.96,
    strokeOpacity: (dark ? 0.26 : 0.12) * monoIntensity,
    innerOpacity: (dark ? 0.42 : 0.26) * monoIntensity,
    bloomOpacity: (dark ? 0.24 : 0.34) * monoIntensity,
    innerShadow: dark ? "rgba(255, 255, 255, 0.27)" : "rgba(0, 0, 0, 0.14)",
    colorVariant: "mono",
    staticColors: true,
    brightness: 1.3,
    saturation: dark ? 1.2 : 1.5,
    hueRange: 30,
    theme,
  }) + `
/* Ciele: preserve the loading indication without movement when requested. */
@media (prefers-reduced-motion: reduce) {
  [data-beam="${id}"][data-active] {
    animation: none;
    --beam-opacity-${id}: 1;
  }
  [data-beam="${id}"]::before,
  [data-beam="${id}"]::after {
    animation: none !important;
  }
}
`;
}

const colorPalettes = {
  colorful: {
    border: [
      { color: 'rgb(255, 50, 100)', pos: '33% -7.4%', size: '70px 40px' },
      { color: 'rgb(40, 140, 255)', pos: '12% -5%', size: '60px 35px' },
      { color: 'rgb(50, 200, 80)', pos: '2.1% 68.3%', size: '40px 70px' },
      { color: 'rgb(30, 185, 170)', pos: '2.1% 68.3%', size: '20px 35px' },
      { color: 'rgb(100, 70, 255)', pos: '74.4% 100%', size: '180px 32px' },
      { color: 'rgb(40, 140, 255)', pos: '55% 100%', size: '85px 26px' },
      { color: 'rgb(255, 120, 40)', pos: '93.9% 0%', size: '74px 32px' },
      { color: 'rgb(240, 50, 180)', pos: '100% 27.1%', size: '26px 42px' },
      { color: 'rgb(180, 40, 240)', pos: '100% 27.1%', size: '52px 48px' },
    ],
    spike: { primary: 'rgb(255, 60, 80)', secondary: 'rgba(40, 190, 180, 0.98)' },
    spikeLt: { primary: 'rgb(200, 30, 60)', secondary: 'rgb(20, 150, 140)' },
  },
  mono: {
    border: [
      { color: 'rgb(180, 180, 180)', pos: '33% -7.4%', size: '70px 40px' },
      { color: 'rgb(140, 140, 140)', pos: '12% -5%', size: '60px 35px' },
      { color: 'rgb(160, 160, 160)', pos: '2.1% 68.3%', size: '40px 70px' },
      { color: 'rgb(130, 130, 130)', pos: '2.1% 68.3%', size: '20px 35px' },
      { color: 'rgb(170, 170, 170)', pos: '74.4% 100%', size: '180px 32px' },
      { color: 'rgb(150, 150, 150)', pos: '55% 100%', size: '85px 26px' },
      { color: 'rgb(190, 190, 190)', pos: '93.9% 0%', size: '74px 32px' },
      { color: 'rgb(145, 145, 145)', pos: '100% 27.1%', size: '26px 42px' },
      { color: 'rgb(165, 165, 165)', pos: '100% 27.1%', size: '52px 48px' },
    ],
    spike: { primary: 'rgb(200, 200, 200)', secondary: 'rgb(170, 170, 170)' },
    spikeLt: { primary: 'rgb(80, 80, 80)', secondary: 'rgb(120, 120, 120)' },
  },
};

function getColorGradients(colorVariant: BorderBeamColorVariant): string {
  const palette = colorPalettes[colorVariant];
  return palette.border
    .map(c => `radial-gradient(ellipse ${c.size} at ${c.pos}, ${c.color}, transparent)`)
    .join(',\n    ');
}

function getInnerGradients(colorVariant: BorderBeamColorVariant): string {
  const palette = colorPalettes[colorVariant];
  // Mono variant gets 50% lower opacity
  const baseOpacity = colorVariant === 'mono' ? 0.225 : 0.45;
  return palette.border
    .map(c => {
      const rgba = c.color.replace('rgb(', 'rgba(').replace(')', `, ${baseOpacity})`);
      const smallerSize = c.size.split(' ').map(s => {
        const val = parseInt(s);
        return `${Math.round(val * 0.9)}px`;
      }).join(' ');
      return `radial-gradient(ellipse ${smallerSize} at ${c.pos}, ${rgba}, transparent)`;
    })
    .join(',\n    ');
}

function pausedAnimationsRule(id: string): string {
  return `
[data-beam="${id}"][data-paused],
[data-beam="${id}"][data-paused]::after,
[data-beam="${id}"][data-paused]::before,
[data-beam="${id}"][data-paused] [data-beam-bloom] {
  animation-play-state: paused !important;
}`;
}


function scaleBlur(px: number, glowSize = 1): number {
  return Math.max(0.5, Math.round(px * glowSize * 100) / 100);
}

function generateBorderVariantCSS(options: GenerateStylesOptions): string {
  const {
    id,
    borderRadius,
    borderWidth,
    duration,
    strokeOpacity,
    innerOpacity,
    bloomOpacity,
    innerShadow,
    colorVariant,
    staticColors,
    brightness,
    saturation,
    hueRange,
    theme,
    glowSize = 1,
  } = options;

  const innerRadius = `max(0px, calc(${borderRadius} - ${borderWidth}px))`;

  // Mono variant gets 50% lower opacity
  const monoOpacityMultiplier = colorVariant === 'mono' ? 0.5 : 1.0;
  const finalStrokeOpacity = strokeOpacity * monoOpacityMultiplier;
  const finalInnerOpacity = innerOpacity * monoOpacityMultiplier;
  const finalBloomOpacity = bloomOpacity * monoOpacityMultiplier;

  const hueShiftAnimation = staticColors
    ? ''
    : `animation: beam-hue-shift-${id} 12s ease-in-out infinite;`;

  const hueShiftKeyframes = staticColors ? '' : `
@keyframes beam-hue-shift-${id} {
  0% { filter: hue-rotate(calc(var(--beam-hue-base, 0deg) - ${hueRange}deg)) brightness(${brightness.toFixed(2)}) saturate(${saturation.toFixed(2)}); }
  50% { filter: hue-rotate(calc(var(--beam-hue-base, 0deg) + ${hueRange}deg)) brightness(${brightness.toFixed(2)}) saturate(${saturation.toFixed(2)}); }
  100% { filter: hue-rotate(calc(var(--beam-hue-base, 0deg) - ${hueRange}deg)) brightness(${brightness.toFixed(2)}) saturate(${saturation.toFixed(2)}); }
}`;

  const isDark = theme === 'dark';

  const whiteGradient = isDark
    ? `conic-gradient(
        from var(--beam-angle-${id}),
        transparent 0%, transparent 54%,
        rgba(255, 255, 255, 0.1) 57%,
        rgba(255, 255, 255, 0.3) 60%,
        rgba(255, 255, 255, 0.6) 63%,
        rgba(255, 255, 255, 0.75) 66%,
        rgba(255, 255, 255, 0.6) 69%,
        rgba(255, 255, 255, 0.3) 72%,
        rgba(255, 255, 255, 0.1) 75%,
        transparent 78%, transparent 100%
      )`
    : `conic-gradient(
        from var(--beam-angle-${id}),
        transparent 0%, transparent 54%,
        rgba(0, 0, 0, 0.08) 57%,
        rgba(0, 0, 0, 0.2) 60%,
        rgba(0, 0, 0, 0.4) 63%,
        rgba(0, 0, 0, 0.55) 66%,
        rgba(0, 0, 0, 0.4) 69%,
        rgba(0, 0, 0, 0.2) 72%,
        rgba(0, 0, 0, 0.08) 75%,
        transparent 78%, transparent 100%
      )`;

  const colorGradients = getColorGradients(colorVariant);
  const innerGradients = getInnerGradients(colorVariant);

  const bloomGradient = isDark
    ? `conic-gradient(
        from var(--beam-angle-${id}),
        transparent 0%, transparent 58%,
        rgba(255, 255, 255, 0.03) 62%,
        rgba(255, 255, 255, 0.08) 65%,
        rgba(255, 255, 255, 0.2) 67%,
        rgba(255, 255, 255, 0.45) 69%,
        rgba(255, 255, 255, 0.85) 70%,
        rgba(255, 255, 255, 0.85) 70.5%,
        rgba(255, 255, 255, 0.45) 71.5%,
        rgba(255, 255, 255, 0.2) 73%,
        rgba(255, 255, 255, 0.08) 75%,
        rgba(255, 255, 255, 0.03) 78%,
        transparent 82%
      )`
    : `conic-gradient(
        from var(--beam-angle-${id}),
        transparent 0%, transparent 58%,
        rgba(0, 0, 0, 0.02) 62%,
        rgba(0, 0, 0, 0.08) 65%,
        rgba(0, 0, 0, 0.2) 67%,
        rgba(0, 0, 0, 0.4) 69%,
        rgba(0, 0, 0, 0.6) 70%,
        rgba(0, 0, 0, 0.6) 70.5%,
        rgba(0, 0, 0, 0.4) 71.5%,
        rgba(0, 0, 0, 0.2) 73%,
        rgba(0, 0, 0, 0.08) 75%,
        rgba(0, 0, 0, 0.02) 78%,
        transparent 82%
      )`;

  return `
@property --beam-angle-${id} {
  syntax: "<angle>";
  initial-value: 0deg;
  inherits: true;
}

@property --beam-opacity-${id} {
  syntax: "<number>";
  initial-value: 0;
  inherits: true;
}

[data-beam="${id}"] {
  position: relative;
  border-radius: ${borderRadius};
  overflow: hidden;
}

[data-beam="${id}"][data-active] {
  animation:
    beam-spin-${id} ${duration}s linear infinite,
    beam-fade-in-${id} 0.6s ease forwards;
}

[data-beam="${id}"][data-fading] {
  animation:
    beam-spin-${id} ${duration}s linear infinite,
    beam-fade-out-${id} 0.5s ease forwards;
}

[data-beam="${id}"][data-active]::after,
[data-beam="${id}"][data-fading]::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: ${innerRadius};
  padding: ${borderWidth}px;
  clip-path: inset(0 round ${borderRadius});
  background: ${whiteGradient},${colorGradients};
  -webkit-mask:
    conic-gradient(
      from var(--beam-angle-${id}),
      transparent 0%, transparent 30%,
      rgba(255, 255, 255, 0.1) 36%, rgba(255, 255, 255, 0.35) 44%,
      white 52%, white 80%,
      rgba(255, 255, 255, 0.35) 86%, rgba(255, 255, 255, 0.1) 92%,
      transparent 95%, transparent 100%
    ),
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: source-in, xor;
  mask:
    conic-gradient(
      from var(--beam-angle-${id}),
      transparent 0%, transparent 30%,
      rgba(255, 255, 255, 0.1) 36%, rgba(255, 255, 255, 0.35) 44%,
      white 52%, white 80%,
      rgba(255, 255, 255, 0.35) 86%, rgba(255, 255, 255, 0.1) 92%,
      transparent 95%, transparent 100%
    ),
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: intersect, exclude;
  pointer-events: none;
  z-index: 2;
  opacity: calc(var(--beam-opacity-${id}) * ${finalStrokeOpacity.toFixed(2)} * var(--beam-stroke-opacity, 1) * var(--beam-strength, 1));
  ${hueShiftAnimation}
}

[data-beam="${id}"][data-active]::before,
[data-beam="${id}"][data-fading]::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: ${borderRadius};
  background: ${innerGradients};
  box-shadow: inset 0 0 9px 1px ${innerShadow};
  -webkit-mask-image:
    conic-gradient(
      from var(--beam-angle-${id}),
      transparent 0%, transparent 30%,
      rgba(255, 255, 255, 0.1) 36%, rgba(255, 255, 255, 0.35) 44%,
      white 52%, white 80%,
      rgba(255, 255, 255, 0.35) 86%, rgba(255, 255, 255, 0.1) 92%,
      transparent 95%, transparent 100%
    ),
    linear-gradient(white, transparent 28px, transparent calc(100% - 28px), white),
    linear-gradient(to right, white, transparent 28px, transparent calc(100% - 28px), white);
  -webkit-mask-composite: source-in, source-over;
  mask-image:
    conic-gradient(
      from var(--beam-angle-${id}),
      transparent 0%, transparent 30%,
      rgba(255, 255, 255, 0.1) 36%, rgba(255, 255, 255, 0.35) 44%,
      white 52%, white 80%,
      rgba(255, 255, 255, 0.35) 86%, rgba(255, 255, 255, 0.1) 92%,
      transparent 95%, transparent 100%
    ),
    linear-gradient(white, transparent 28px, transparent calc(100% - 28px), white),
    linear-gradient(to right, white, transparent 28px, transparent calc(100% - 28px), white);
  mask-composite: intersect, add;
  pointer-events: none;
  z-index: 1;
  opacity: calc(var(--beam-opacity-${id}) * ${finalInnerOpacity.toFixed(2)} * var(--beam-inner-opacity, 1) * var(--beam-strength, 1));
  clip-path: inset(0 round ${borderRadius});
  ${hueShiftAnimation}
}

[data-beam="${id}"] [data-beam-bloom] {
  display: none;
  position: absolute;
  inset: 0;
  border-radius: ${innerRadius};
  clip-path: inset(0 round ${borderRadius});
  background: ${bloomGradient};
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask-composite: exclude;
  padding: ${borderWidth}px;
  filter: blur(${scaleBlur(8, glowSize)}px) brightness(${brightness.toFixed(2)}) saturate(${saturation.toFixed(2)});
  pointer-events: none;
  z-index: 3;
  opacity: 0;
}

[data-beam="${id}"][data-active] [data-beam-bloom],
[data-beam="${id}"][data-fading] [data-beam-bloom] {
  display: block;
  opacity: calc(var(--beam-opacity-${id}) * ${finalBloomOpacity.toFixed(2)} * var(--beam-bloom-opacity, 1) * var(--beam-strength, 1));
}

@keyframes beam-spin-${id} {
  to { --beam-angle-${id}: 360deg; }
}

@keyframes beam-fade-in-${id} {
  to { --beam-opacity-${id}: 1; }
}

@keyframes beam-fade-out-${id} {
  from { --beam-opacity-${id}: 1; }
  to { --beam-opacity-${id}: 0; }
}
${hueShiftKeyframes}
${pausedAnimationsRule(id)}
`;
}
