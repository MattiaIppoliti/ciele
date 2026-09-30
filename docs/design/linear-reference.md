# Linear design reference

The design direction Ciele is moving toward, kept as supplied. It analyses Linear's marketing
canvas, not Ciele: read it as the target to converge on, and read [`DESIGN.md`](../../DESIGN.md)
§8 for what Ciele takes from it, what it adapts, and what it keeps of its own (the light theme,
the palettes, Host Grotesk, the contrast figures). When the two disagree, `DESIGN.md` and the code
win; this file does not change what a class string may say.

---

```yaml
version: alpha
name: Linear-design-analysis
description: "A near-black product-focused marketing canvas built around #010102 (the deepest dark surface of any tool in this collection), light gray text (#f7f8f8), and the signature Linear lavender-blue (#5e6ad2) used as the single chromatic accent. The system reads as software-craft documentation: dense, technical, and quietly luxurious. Display type is set in the Linear custom sans (SF Pro Display fallback) at 500–700 with measured negative tracking. Cards live as charcoal panels (#0f1011) with hairline borders. The accent lavender appears on the brand mark, focus rings, and a few intentional CTAs, never decoratively. Page rhythm leans on product UI screenshots framed in dark panels rather than atmospheric color."

colors:
  primary: "#5e6ad2"
  on-primary: "#ffffff"
  primary-hover: "#828fff"
  primary-focus: "#5e69d1"
  ink: "#f7f8f8"
  ink-muted: "#d0d6e0"
  ink-subtle: "#8a8f98"
  ink-tertiary: "#62666d"
  canvas: "#010102"
  surface-1: "#0f1011"
  surface-2: "#141516"
  surface-3: "#18191a"
  surface-4: "#191a1b"
  hairline: "#23252a"
  hairline-strong: "#34343a"
  hairline-tertiary: "#3e3e44"
  inverse-canvas: "#ffffff"
  inverse-surface-1: "#f5f6f6"
  inverse-surface-2: "#f6f7f7"
  inverse-ink: "#000000"
  brand-secure: "#7a7fad"
  semantic-success: "#27a644"
  semantic-overlay: "#000000"

typography:
  display-xl:   { fontFamily: Linear Display, fontSize: 80px, fontWeight: 600, lineHeight: 1.05, letterSpacing: -3.0px }
  display-lg:   { fontFamily: Linear Display, fontSize: 56px, fontWeight: 600, lineHeight: 1.10, letterSpacing: -1.8px }
  display-md:   { fontFamily: Linear Display, fontSize: 40px, fontWeight: 600, lineHeight: 1.15, letterSpacing: -1.0px }
  headline:     { fontFamily: Linear Display, fontSize: 28px, fontWeight: 600, lineHeight: 1.20, letterSpacing: -0.6px }
  card-title:   { fontFamily: Linear Display, fontSize: 22px, fontWeight: 500, lineHeight: 1.25, letterSpacing: -0.4px }
  subhead:      { fontFamily: Linear Display, fontSize: 20px, fontWeight: 400, lineHeight: 1.40, letterSpacing: -0.2px }
  body-lg:      { fontFamily: Linear Text, fontSize: 18px, fontWeight: 400, lineHeight: 1.50, letterSpacing: -0.1px }
  body:         { fontFamily: Linear Text, fontSize: 16px, fontWeight: 400, lineHeight: 1.50, letterSpacing: -0.05px }
  body-sm:      { fontFamily: Linear Text, fontSize: 14px, fontWeight: 400, lineHeight: 1.50, letterSpacing: 0 }
  caption:      { fontFamily: Linear Text, fontSize: 12px, fontWeight: 400, lineHeight: 1.40, letterSpacing: 0 }
  button:       { fontFamily: Linear Text, fontSize: 14px, fontWeight: 500, lineHeight: 1.20, letterSpacing: 0 }
  eyebrow:      { fontFamily: Linear Text, fontSize: 13px, fontWeight: 500, lineHeight: 1.30, letterSpacing: 0.4px }
  mono:         { fontFamily: Linear Mono, fontSize: 13px, fontWeight: 400, lineHeight: 1.50, letterSpacing: 0 }

rounded: { xs: 4px, sm: 6px, md: 8px, lg: 12px, xl: 16px, xxl: 24px, pill: 9999px, full: 9999px }

spacing: { xxs: 4px, xs: 8px, sm: 12px, md: 16px, lg: 24px, xl: 32px, xxl: 48px, section: 96px }

components:
  button-primary:         { backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", typography: "{typography.button}", rounded: "{rounded.md}", padding: 8px 14px }
  button-primary-pressed: { backgroundColor: "{colors.primary-focus}", textColor: "{colors.on-primary}", typography: "{typography.button}", rounded: "{rounded.md}" }
  button-primary-hover:   { backgroundColor: "{colors.primary-hover}", textColor: "{colors.on-primary}", typography: "{typography.button}", rounded: "{rounded.md}" }
  button-secondary:       { backgroundColor: "{colors.surface-1}", textColor: "{colors.ink}", typography: "{typography.button}", rounded: "{rounded.md}", padding: 8px 14px }
  button-tertiary:        { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.button}", rounded: "{rounded.md}", padding: 8px 14px }
  button-inverse:         { backgroundColor: "{colors.inverse-canvas}", textColor: "{colors.inverse-ink}", typography: "{typography.button}", rounded: "{rounded.md}", padding: 8px 14px }
  pricing-card:           { backgroundColor: "{colors.surface-1}", textColor: "{colors.ink}", typography: "{typography.body}", rounded: "{rounded.lg}", padding: 24px }
  pricing-card-featured:  { backgroundColor: "{colors.surface-2}", textColor: "{colors.ink}", typography: "{typography.body}", rounded: "{rounded.lg}", padding: 24px }
  feature-card:           { backgroundColor: "{colors.surface-1}", textColor: "{colors.ink}", typography: "{typography.body}", rounded: "{rounded.lg}", padding: 24px }
  product-screenshot-card: { backgroundColor: "{colors.surface-1}", textColor: "{colors.ink}", typography: "{typography.body}", rounded: "{rounded.xl}", padding: 24px }
  testimonial-card:       { backgroundColor: "{colors.surface-1}", textColor: "{colors.ink}", typography: "{typography.body-lg}", rounded: "{rounded.lg}", padding: 32px }
  customer-logo-tile:     { backgroundColor: "{colors.canvas}", textColor: "{colors.ink-subtle}", typography: "{typography.caption}", rounded: "{rounded.xs}", padding: 16px }
  text-input:             { backgroundColor: "{colors.surface-1}", textColor: "{colors.ink}", typography: "{typography.body}", rounded: "{rounded.md}", padding: 8px 12px }
  text-input-focused:     { backgroundColor: "{colors.surface-1}", textColor: "{colors.ink}", typography: "{typography.body}", rounded: "{rounded.md}", padding: 8px 12px }
  pricing-tab-default:    { backgroundColor: "{colors.canvas}", textColor: "{colors.ink-subtle}", typography: "{typography.button}", rounded: "{rounded.pill}", padding: 6px 14px }
  pricing-tab-selected:   { backgroundColor: "{colors.surface-2}", textColor: "{colors.ink}", typography: "{typography.button}", rounded: "{rounded.pill}", padding: 6px 14px }
  cta-banner:             { backgroundColor: "{colors.surface-1}", textColor: "{colors.ink}", typography: "{typography.headline}", rounded: "{rounded.lg}", padding: 48px }
  changelog-row:          { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.body}", rounded: "{rounded.xs}", padding: 24px 0 }
  status-badge:           { backgroundColor: "{colors.surface-2}", textColor: "{colors.ink-muted}", typography: "{typography.caption}", rounded: "{rounded.pill}", padding: 2px 8px }
  top-nav:                { backgroundColor: "{colors.canvas}", textColor: "{colors.ink}", typography: "{typography.body-sm}", rounded: "{rounded.xs}", height: 56px }
  footer:                 { backgroundColor: "{colors.canvas}", textColor: "{colors.ink-subtle}", typography: "{typography.caption}", rounded: "{rounded.xs}", padding: 64px 32px }
```

## Overview

Linear's marketing canvas is the deepest dark surface in the collection: `canvas` is `#010102`,
essentially black with a faint blue tint. On it sits a four-step surface ladder (`surface-1` to
`surface-4`) for cards, panels and lifted tiles, with hairline borders from `hairline` (`#23252a`)
up through `hairline-strong` and `hairline-tertiary`. Light grey ink (`#f7f8f8`) carries body and
headlines.

The single chromatic accent is lavender-blue `#5e6ad2`, on the brand mark, focus rings and the
primary CTA, with a lighter hover (`#828fff`) and a focus tint (`#5e69d1`). The only semantic
colour on the marketing canvas is success green `#27a644`.

Display type runs a custom sans at 500-700 with negative tracking scaling from -3.0px at 80px to
0 at body; a custom mono is reserved for code in product screenshots. The page rhythm is dense
product screenshots framed in `surface-1` panels with 16px corners; the chrome stays minimal so
the app does the work.

**Key characteristics**

- A dark canvas as the anchor surface.
- Lavender used scarcely: brand mark, focus, primary CTA, link emphasis.
- A four-step surface ladder carries hierarchy without shadow.
- Display tracking pulls negative; body holds near zero.
- Cards at 12px corners with 1px hairlines; never pill, rarely 16px.
- Product UI is the protagonist; the chrome is a frame for it.
- No second chromatic colour, no atmospheric gradients, no spotlight cards.

## Elevation and depth

| Level | Treatment | Use |
|---|---|---|
| 0 | No shadow, no border | Body type, hero text, footer |
| 1 | `surface-1` on canvas, 1px `hairline` | Default cards, product panels |
| 2 | `surface-2`, 1px `hairline-strong` | Featured and hovered cards |
| 3 | `surface-3` | Sub-nav, dropdown menus |
| 4 | 2px `primary-focus` outline at 50% | Focused input or button |

Depth comes from the surface ladder and hairlines, with a faint white highlight on the top edge
of lifted panels. Drop shadows on dark are almost absent.

## Shapes

| Token | Value | Use |
|---|---|---|
| `xs` | 4px | Small chips, status badges |
| `sm` | 6px | Inline tags |
| `md` | 8px | All buttons, form inputs |
| `lg` | 12px | Cards |
| `xl` | 16px | Product screenshot panels |
| `xxl` | 24px | Oversized CTA banners (rare) |
| `pill` / `full` | 9999px | Tab toggles, status pills, avatars |

## Components (summary)

- **Buttons**: 8px corners, 8px/14px padding, 14px/500 label. Primary lavender, secondary on
  `surface-1` with a hairline, tertiary plain, inverse white.
- **Tabs**: pills; selected is a surface lift (`surface-2`), not a colour.
- **Cards**: `surface-1`, 12px corners, 24px padding, 1px hairline; featured lifts to `surface-2`.
- **Inputs**: `surface-1`, 8px corners, 8px/12px padding; focus keeps the surface and adds the
  50% lavender ring.
- **Status badge**: `surface-2` pill, muted ink, caption type.
- **Top nav**: 56px on the canvas.

## Do and don't

**Do**: keep the dark canvas as the anchor; keep lavender to brand mark, primary CTA, focus and
link emphasis; use the surface ladder without skipping levels; pair display 600 with body 400;
track display negatively; let product UI lead; give CTAs 8px corners.

**Don't**: use lavender as a fill or background; add a second chromatic accent; add atmospheric
gradients or spotlight cards; pill-round CTAs; use `#000000` as the canvas; combine several
bright accents in one mockup.

## Responsive behaviour

| Name | Width | Changes |
|---|---|---|
| Desktop-XL | 1440px | Default |
| Desktop | 1280px | 3-up grids |
| Tablet | 1024px | 3-up → 2-up |
| Mobile-Lg | 768px | Accordions, hamburger nav |
| Mobile | 480px | Single column; display scales down |

CTAs hold at least 40px tap height, inputs 44px on touch.

## Known gaps in the source analysis

- Form error and validation styling was not visible on the inspected pages.
- Light mode is undocumented: the marketing site ships none.
- The in-product colour-tag palette (priorities, labels) lives in the app, not on the marketing
  canvas.
- The typefaces are proprietary; Inter or Geist are the usual substitutes.
