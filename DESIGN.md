---
version: alpha
name: Ciele
description: "A neutral admin console for AI assistants, laid out like Linear's app: the sidebar sits on a darker frame and the workspace is one rounded panel lifted off it, with the top bar inside. Monochrome grounds (#f5f5f5 light, #121212 dark) built from translucent alphas, Host Grotesk throughout, two elevations, six status tones, and a single chromatic accent borrowed from Linear's lavender (#5e6ad2) for the committing button, the focus ring and link emphasis. The marketing site and the docs stay monochrome."

colors:
  brand: "#5e6ad2"
  on-brand: "#ffffff"
  brand-hover: "color-mix(in oklab, #5e6ad2, black 12%)"
  brand-ink: "#4c57c0"
  brand-ink-dark: "#828fff"
  canvas: "#f5f5f5"
  canvas-dark: "#010102"
  content-dark: "#0f1011"
  shell: "#ebebeb"
  shell-dark: "#010102"
  rail: "#ededed"
  rail-dark: "#18191a"
  surface: "#f1f1f1"
  surface-dark: "#141516"
  table-frame: "#dcdcdc"
  table-frame-dark: "#0b0c0d"
  hairline-dark: "#23252a"
  ink: "oklch(0.145 0 0)"
  ink-dark: "#f7f8f8"
  ink-muted: "oklch(0.52 0 0)"
  ink-muted-dark: "#8a8f98"
  alpha-lighter: "rgba(0,0,0,0.02)"
  alpha-light: "rgba(0,0,0,0.04)"
  alpha-medium: "rgba(0,0,0,0.08)"
  alpha-strong: "rgba(0,0,0,0.16)"
  destructive: "oklch(0.577 0.245 27.325)"

typography:
  page-title:
    fontFamily: Host Grotesk
    fontSize: 1.5rem
    fontWeight: 600
    letterSpacing: -0.02em
  card-title:
    fontFamily: Host Grotesk
    fontSize: 1rem
    fontWeight: 600
    letterSpacing: 0
  body:
    fontFamily: Host Grotesk
    fontSize: 0.875rem
    fontWeight: 400
    letterSpacing: 0.005em
  label:
    fontFamily: Host Grotesk
    fontSize: 0.875rem
    fontWeight: 500
  caption:
    fontFamily: Host Grotesk
    fontSize: 0.75rem
    fontWeight: 400
    letterSpacing: 0.01em
  micro:
    fontFamily: Host Grotesk
    fontSize: 0.6875rem
    fontWeight: 500
    letterSpacing: 0.015em
  eyebrow:
    fontFamily: Host Grotesk
    fontSize: 0.75rem
    fontWeight: 500
    letterSpacing: 0.05em
    textTransform: uppercase
  mono:
    fontFamily: Geist Mono
    fontSize: 0.75rem
    fontWeight: 400

rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  2xl: 16px
  pill: 9999px

spacing:
  base: 4px

elevation:
  light: "0 0 4px rgba(0,0,0,.08), 0 2px 4px rgba(0,0,0,.04)"
  strong: "0 2px 4px rgba(0,0,0,.04), 2px 4px 16px rgba(0,0,0,.12)"

components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-brand}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    height: 32px
  button-secondary:
    backgroundColor: "{colors.alpha-lighter}"
    borderColor: "{colors.alpha-medium}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: 16px
  shell-frame:
    backgroundColor: "{colors.shell}"
  workspace-panel:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.xl}"
  top-bar:
    height: 56px
  rail-card:
    backgroundColor: "{colors.rail}"
    rounded: "{rounded.xl}"
  status-badge:
    rounded: "{rounded.pill}"
    typography: "{typography.caption}"
  focus-ring:
    color: "{colors.brand}"
    width: 3px
    opacity: 0.5
---

# DESIGN.md: the Ciele design system

How the console, the widget, the marketing site and the docs look, and why. Read it before you
touch a class string. It covers the tokens, the primitives that consume them, the rules for
adding either, and the drift the codebase carries today, measured.

The system is small on purpose. It has four surface alphas, two elevations, six tag tones, one
accent, one radius, one empty state and one press contract. Most UI bugs in this repo's history came from a
call site that made its own choice where one of those already existed: a grey that matched one
background, a shadow nobody else used, a status colour with a hand-written `dark:` twin.

> **Source of truth.** Tokens are declared in [`apps/web/src/app/globals.css`](apps/web/src/app/globals.css)
> and repeated in `apps/docs/src/app/global.css` and the staff console's stylesheet, because
> Tailwind resolves `@theme` per app. **Add a token to all three or to none.** Motion constants
> live in [`apps/web/src/lib/ease.ts`](apps/web/src/lib/ease.ts). Shared primitives live in
> [`packages/ui/src`](packages/ui/src); app-only ones in `apps/web/src/components/ui` and
> `apps/web/src/components/motion`. If this file and the code disagree, the code wins and this
> file is the bug.

The front matter above is the token set in the `design.md` format, so a design tool or an agent
can read it without parsing CSS. It summarises `globals.css`; it does not replace it, and a value
changed in one without the other is a bug in the front matter.

---

## 1. Principles

1. **Monochrome first, colour means state.** The ground, the ink and every control are neutral.
   Colour appears only when it carries information: a status, a destructive action, a chart
   series. A decorative colour competes with the one that means "this failed". The one exception
   is the **accent** (§2.1), and it is scarce by rule: the committing button, the focus ring and
   an inline link, never a fill, a card title or a section background.
2. **Translucent, not grey.** A control is built from black (white in dark mode) at a fixed
   alpha, so it keeps its weight over the shell, over a card and over a coloured banner. A literal
   grey matches exactly one of those.
3. **A token per decision, not per use.** `alpha-medium` is the chip, the divider and the button
   border at the same time. Naming tokens after their step, not their consumer, is what keeps the
   set at four.
4. **Dark mode is a token swap.** A component written against tokens needs no `dark:` class. Every
   `dark:` pair is two decisions that drift the first time someone edits only one side.
5. **Every press is acknowledged.** Hover never fires on touch. A surface that does something on
   click shows it on pointer-down.
6. **Respect what the OS asks for.** Reduced motion, reduced transparency, increased contrast and
   forced colours each have a rule in `globals.css`. They work only if components use the tokens
   those rules rewrite.
7. **Industry-agnostic copy.** The product serves any organisation. No wording for one sector in
   labels, placeholders, empty states or mock data.

---

## 2. Tokens

### 2.1 Colour: grounds and ink

| Token (Tailwind) | Light | Dark | Use |
|---|---|---|---|
| `bg-shell` | `#ebebeb` | `#010102` | The frame the sidebar and the Developer Panel sit on, around the workspace panel |
| `bg-background` | `#f5f5f5` | `#010102` | Page ground, dialogs, the hover-peek sidebar and the phone drawer |
| `bg-content` | = background | `#0f1011` | The workspace panel: top bar, page and the Preview rail |
| `bg-rail` | `#ededed` | `#18191a` | A right-rail card that needs its own edge (the Flows Agent) |
| `bg-card` / `bg-popover` | `#f1f1f1` | `#141516` | Cards, popovers, panels |
| `bg-muted` / `bg-secondary` / `bg-accent` | `#f1f1f1` | `#18191a` | Recessed panels, hover rows |
| `bg-table-frame` | `#dcdcdc` | `#0b0c0d` | A table card's header band and footer, one step darker than its rows |
| `border` / `input` | `oklch(0.922 0 0)` | `#23252a` / `#34343a` | Hairlines: cards and panels, then inputs |
| `text-foreground` | `oklch(0.145 0 0)` | `#f7f8f8` | Body ink |
| `text-muted-foreground` | `oklch(0.52 0 0)` | `#8a8f98` | Secondary ink. 0.52 is ~5.0:1 on the ground; `#8a8f98` is 5.4:1 on the darkest control surface and better elsewhere |
| `bg-primary` / `text-primary-foreground` | near-black / white | near-white / near-black | Solid neutral ink: avatars, checked controls, the old CTA |
| `bg-brand` / `text-brand-foreground` | `#5e6ad2` / white | `#5e6ad2` / white | **The page's one committing action** (`Button` `default`). 4.7:1 |
| `hover:bg-brand-hover` | brand + 12% black | same | Hover on it. Darker, not lighter: Linear's `#828fff` under white text is 2.9:1 |
| `text-brand-ink` | `#4c57c0` | `#828fff` | An inline link that should stand out. `#5e6ad2` as text is 4.3:1 on `#f5f5f5` |
| `text-destructive` | `oklch(0.577 0.245 27)` | `oklch(0.704 0.191 22)` | Destructive actions and invalid fields only |
| `ring-ring` | `#5e6ad2` in the console, grey elsewhere | same | Focus rings, drawn at 50% (`ring-ring/50`) |
| `chart-1..5` | grey ramp | grey ramp | Default chart series (see `packages/charts`) |

The brand tokens are lavender only on the admin surface's Midnight palette. On the marketing
site and the docs they equal `primary`, so a shared `Button` is a black (or white) pill there;
Mist Blue resets them to its own navy. Under increased contrast the ring and the link ink deepen
to `#3f49b3` (light) and `#aab2ff` (dark).

A `bg-card` element with `rounded-xl` or `rounded-2xl` gets the **card sheen** automatically: a
lit top hairline and a soft glow drawn as background images. Do not add your own gradient to a
card; it will fight the sheen.

**The dark column is Midnight in the console, and it is Linear's.** Its ground, its four-step surface
ladder (canvas `#010102` → panel `#0f1011` → card `#141516` → controls and rail `#18191a`), its
hairlines and its ink come straight from [`docs/design/linear-reference.md`](docs/design/linear-reference.md),
in one block scoped to `html.dark[data-app-surface="admin"]:not([data-color-palette="mist-blue"])`.
The generic `.dark` block underneath keeps the older neutral greys (`#121212` / `#171717` /
`#191919`) for the marketing site, the docs and the widget, which Linear's canvas was never meant
for. Increased contrast raises the muted ink to Linear's `#d0d6e0` and the hairlines to `#3e3e44`.
The light column is unchanged: Linear documents no light theme.

`shell`, `content` and `rail` are the console shell's own tokens and live only in
`apps/web/src/app/globals.css`: the docs and the staff console have no workspace panel, which is the
one exception to "all three or none". `shell` is a step darker than `content` so the panel reads as lifted off the frame, the way
Linear's app sits a lighter panel on a darker ground. Mist Blue defines its own pair
(`#f3f4f6` / `#0f141a`), so the frame survives the palette switch.

`.light` forces the light tokens on a subtree (the auth pages), and it also disables `dark:`
utilities inside it through the custom `dark` variant. Do not nest a `.dark` island inside a
`.light` one.

### 2.2 Colour: surface alphas

| Token | Light | Dark | Typical use |
|---|---|---|---|
| `alpha-lighter` | `rgba(0,0,0,.02)` | `rgba(255,255,255,.03)` | Resting fill of a secondary control, zebra rows |
| `alpha-light` | `.04` | `.06` | Hover fill, `aria-expanded` fill |
| `alpha-medium` | `.08` | `.11` | Control borders, chips, dividers |
| `alpha-strong` | `.16` | `.22` | Pressed or selected fill, strong hairline |

Available as `bg-`, `border-` and `ring-`. **For any new control surface or hairline, reach for
these first.** `bg-muted`, `border-input` and `bg-background` on a control are the patterns
these replace.

### 2.3 Colour: tag tones

`tone-<hue>` (pale surface) + `tone-<hue>-ink` (dark end of the same hue) for `gray`, `blue`,
`green`, `amber`, `red`, `purple`. Both halves flip in dark mode.

Use them through `<Badge tone="green">`, never by class at a call site. The one exception is a
**status dot**: a 6-8px dot has to carry the state on its own and a tint disappears at that size,
so a dot uses a solid hue. See the `StatusDot` gap in §6.

Semantic mapping, so two pages agree:

| Meaning | Tone |
|---|---|
| Ready, healthy, published, resolved | `green` |
| Processing, pending, draft, needs attention | `amber` |
| Failed, error, blocked | `red` |
| Informational, new, in progress | `blue` |
| AI-generated, Teammate, beta | `purple` |
| Neutral, archived, disabled, none | `gray` |

### 2.4 Palettes

`data-color-palette` on `<html>` picks the console palette. **Midnight** (the default) carries the
lavender accent. **Mist Blue** is white canvas, navy actions (in both themes, through its own
`--brand`), the same neutral light borders as Midnight, and its accent is its own navy. The provider strips the attribute on the marketing route group, which
stays on the monochrome theme. A component written against tokens needs nothing to support it.
A component with a hard-coded hex breaks it.

### 2.5 Typography

| Face | Variable | Where |
|---|---|---|
| Host Grotesk | `font-sans` | All product UI: console, editor, widget |
| Geist Mono | `font-mono` | Code, ids, keys, CLI snippets |
| Sorts Mill Goudy | `font-heading` | Marketing headings only, through `.marketing-serif` |
| Solitus | `font-brand` | The wordmark |

- **Scale.** Tailwind's steps plus `text-2xs` (0.6875rem, 11px) below `text-xs`. Use `text-2xs`
  where you would write `text-[11px]` or `text-[10px]`.
- **Tracking is bound to the step.** `text-4xl` is already tracked at -0.03em and `text-xs` at
  +0.01em. Do not add `tracking-tight` to a heading; it double-tightens. Use it only to change
  the default deliberately.
- **Density.** The admin surface sets `html { font-size: 92% }`, so every rem-based size and
  control is 8% smaller in the console than on the public site. A `px` value does not follow;
  another reason to avoid them.
- **Weights.** `font-medium` for labels, buttons and table headers; `font-semibold` for page and
  card titles. Nothing in the console is `font-bold`: Linear holds display at 600 and body at 400,
  and so do we. Bold is left to marketing headings and to `<strong>` inside content.
- **Page titles** are `text-2xl font-semibold`, with no `tracking-tight`: the step already carries
  -0.02em.
- **Eyebrows** (the small label over a heading or a group) are
  `text-xs font-medium uppercase tracking-wide text-muted-foreground`. Positive tracking is what
  marks them as taxonomy against a negatively tracked heading.
- **Selection** is a fixed `#333` with white ink on every surface and theme, on purpose.

### 2.6 Radius

One base, `--radius: 8px`, and Linear's steps off it:

| Class | Value | Use |
|---|---|---|
| `rounded-sm` | 4px | Chips, keycaps, checkboxes, a thumbnail inside a row |
| `rounded-md` | 6px | **Rows**: sidebar items, menu and select items, the hover pill; inline tags |
| `rounded-lg` | 8px | **Controls**: buttons, inputs, textareas, select triggers |
| `rounded-xl` | 12px | **Cards**, popovers, menus |
| `rounded-2xl` | 16px | Large panels, dialogs, the command palette |
| `rounded-4xl` / `rounded-full` | pill | Badges, avatars, segmented toggles |

A child's radius is its parent's minus the padding between them, which is what `sm` and `md`
are for. The values are rem-based, so the console's 92% density scales them with everything else.

### 2.7 Elevation

Two, not a ramp:

- `shadow-light`: a resting lift, a control that sits above the page.
- `shadow-strong`: a detached layer, popover, dropdown, drawer, dialog, drag ghost.

Each is a tight contact shadow plus a wide ambient one, retuned denser in dark mode where a
shadow over `#121212` otherwise does nothing. `shadow-md`, `-lg`, `-xl` and `-2xl` are three
different answers to the same question; do not use them in product UI.

Which one: a thing that stays in the layout (a selected card, a switch thumb, a toolbar resting
on the canvas, a tab pill) is `shadow-light`. A thing that floats over other content and can be
dismissed or dragged (menu, tooltip, toast, drawer, dialog, a dragged row) is `shadow-strong`.

Two exemptions, both deliberate:

- **Previews of the embed's own chrome** copy `apps/web/public/widget.js` instead of the console
  scale, because they show the customer what their site will get. The launcher preview is
  `shadow-[0_4px_16px_rgba(0,0,0,0.25)]`, the same value the script paints.
- **Marketing and auth art direction** (`components/home/`, `components/marketing/`,
  `components/auth/`) keeps its large, tinted shadows (`shadow-2xl shadow-indigo-950/40`). They
  light a hero, they do not say how high a layer sits. The desktop app has its own token set and
  no elevations yet.

### 2.8 Icons

- **lucide-react** is the icon set. A few have a motion-drawn twin in `components/ui/icons/`
  (Telescope for Eval, UsersRound for Help Desks), looked up through `localGlyphFor` in
  `ui/icons/local-glyphs.ts`, so a row renders the twin without an `Icon === X` branch of its own.
  Help Desks is the two-figure UsersRound, not a question mark: a help desk is people. Sounds is
  a local Volume2 whose waves pulse on hover; a row that is not a `menuitem` plays its icon by
  carrying `data-animate-group`. Buttons carry 14px icons (`size-3.5`, the `Button` default),
  menu rows 16px (`size-4`), badges 12px.
- **Stroke 1.75 in the console**, not lucide's 2, for Linear's lighter line. One rule in
  `globals.css` matches the icon signature (24-unit viewBox, no fill, the default width), so it
  covers lucide and the animated icons, and leaves alone an icon that sets its own `strokeWidth`
  and every chart. Not 1.5: at the 92% density a 16px icon would draw under one device pixel on
  a 1x screen.
- **Animated icons** (`components/ui/animated-icon.tsx`, `feather-icon.tsx`, `components/ui/icons/`)
  are for a control whose glyph shows what it does on hover or press. They are exempt from
  reduced-motion blanket rules because the motion is local and small; keep it that way.
- Icon-only buttons need an `aria-label`. On touch the admin surface expands every
  `data-size^="icon"` button to a 44px target; a bare `<button>` does not get that.

### 2.9 Motion

Constants live in `lib/ease.ts`. Use them, do not write a new bezier or spring inline.

| Constant | For |
|---|---|
| `EASE_OUT` (`cubic-bezier(.16,1,.3,1)`) | Default for anything entering or changing |
| `EASE_IN_OUT` | Something moving from one place to another on screen |
| `EASE_DRAWER` | Sheets and drawers |
| `EASE_GROW` + `GROW_DURATION_MS` (420) | A surface growing into place (Preview full-screen, launcher) |
| `SPRING_PRESS` | Press feedback in motion components |
| `SPRING_SWAP` | Label or icon slots trading places inside a control |
| `SPRING_PANEL` | Modal and sheet entrances, critically damped |
| `SPRING_THROW` | The only spring allowed to overshoot, and only after a gesture threw something. Pass the release velocity |
| `SPRING_UNFOLD` / `SPRING_REFOLD` | A side panel opening and closing by width: the left sidebar, the Preview rail, the Developer Panel. Opening overshoots a little, closing settles with less. All three use the same pair, so a panel on either side feels the same |

**Press contract** (CSS, in `globals.css`):

- `<Button>` presses itself: `scale(0.97)` + 1px nudge on `:active`, 100ms.
- `.press` for large tappable surfaces (cards, list rows, nav items): `scale(0.985)`.
- `.press-control` for small non-`Button` controls (bare icon buttons, chips, tabs): `scale(0.94)`.
- `.press-text` for links and text triggers: an opacity dip, because scaling text reflows it.
- Reduced motion keeps the acknowledgement and drops the travel (opacity 0.7).

**Sound and haptics** come with the primitive (`packages/ui/src/feedback/`). `Button` carries
`data-foley-press`/`-release`; put `data-foley-toggle` on switches and disclosures and
`data-foley-click` on navigation. A new interaction needs a row in `policy.ts`.

---

## 3. Primitives: which one to use

Import shared primitives from `@agent-hub/ui`, app primitives from `@/components/ui/*` or
`@/components/motion/*`. Check this table before building anything.

| You need | Use | Not |
|---|---|---|
| A button or button-shaped link (12px side padding on 32px, 16px on `lg`) | `Button` (`variant`: default / outline / secondary / ghost / destructive; `size`: xs / sm / default / lg / icon / icon-sm / icon-lg). Links through `render={<Link/>}` | a bare `<button>` with classes |
| A status label | `Badge tone="…"` | `bg-emerald-50 text-emerald-700 dark:…` |
| A tooltip or hint | `Hint` | a `title` attribute on a control |
| A card | `Card` + `CardHeader`/`CardContent`/`CardFooter` (`size="sm"` for dense) | `div.rounded-xl.border.bg-card` by hand |
| A modal | `Dialog` (shared); `confirm-delete-modal` for destructive confirms; `slide-to-confirm` for irreversible ones | a custom overlay |
| A popover | `Popover` (shared) | |
| A menu | `dropdown-menu`, `motion/context-menu` for right-click | |
| A select | `ui/select` | `<select>`, `motion/select` (see §6) |
| Tabs | `motion/tabs` (sliding pill, link tabs) | `ui/tabs` (see §6) |
| A switch | `ui/motion-switch` | `ui/switch` (see §6) |
| Checkbox / radio | `ui/checkbox`, `ui/radio-group` | `<input type="checkbox">` |
| Input / textarea / label | `Input`, `ui/textarea`, `Label`: `alpha-medium` hairline on an `alpha-lighter` fill, 8/12px padding, lavender border and ring on focus | `border-input`, `dark:bg-input/30` |
| A table | `ui/table` + `table-column-header`, `table-pagination`, `table-selection`, `table-menu` | a hand-built `<table>` |
| A sortable list | `ui/sortable-list` | |
| An empty list | `EmptyState` (one drawn mark, your sentence) | a lucide glyph in a dashed circle |
| A page or section title | `SectionHeading` | an `h1` with ad-hoc spacing |
| A loading placeholder | `Skeleton` inside a route `loading.tsx` shaped like the page ([`docs/ui-loading-states.md`](docs/ui-loading-states.md)) | a centred spinner |
| Copy-to-clipboard feedback | `useCopyFeedback` + `CopyFeedbackIcon` | a hand-rolled "Copied!" timer |
| Avatars | `user-avatar`, `generated-avatar`, `assignees` | |
| Code or a snippet | `ui/code-block` | |
| A chart | `packages/charts` + `ui/chart` | a raw Recharts palette |
| Width a user can drag | `use-resizable-width` / `resizable-panel` | |

---

## 4. Patterns

- **Page shell.** The layout of Linear's app: a frame (`bg-shell`) with the sidebar on it, and the
  workspace as one rounded panel (`bg-content rounded-xl border`) lifted off it, inset 8px from
  `md` up and 6px on a phone. The top bar lives *inside* the panel, not across the window. The
  sidebar and the frame are one surface: the sidebar draws no background and no border of its own.
  An iPad (from `md`, 768px) gets the desktop shell; below it the sidebar is a floating rounded
  drawer on the same inset, opened by the desktop's panel toggle, never a hamburger.
- **Sidebar.** Resizable by a handle that sits on the panel's left border (`gap={SHELL_GAP}`), not
  in the gap before it. Dragged below the icon threshold it becomes a rail: the Organization's
  avatar alone at the top, top-level rows only (a fold group shows its parent row, lit while you
  are inside it), and Find plus the expand control move into the top bar, where they also sit
  while the sidebar is hidden. As it narrows, the org switcher gives way in order: the name
  truncates, then the role badge goes, then the chevron. The hidden sidebar's hover-peek lands on
  the panel's own inset and radius, so it covers the panel's edge instead of doubling it.
- **Sidebar groups.** Three captions (`NavSection`): "Workspace" (Assistants through Library),
  "Observability" (Improvements, Insights, Eval: how the Assistants are doing) and "Options"
  (Alerts, Support, Settings). A caption is plain text at `text-xs`, 70% of the rows' muted tone,
  so it reads as secondary; it neither navigates nor folds, and it carries
  `data-highlight-clear`, which takes the sliding hover pill off the row above it (otherwise
  the pill stayed there and looked like a second hover). On the rail a caption becomes a rule.
  Above them, Home / Chat / Settings sit left-aligned as one row; Home stays lit and labelled
  on every console page that is not the Chat or Settings. Fold groups (Overview's sections,
  Settings' tabs) start shut on every load; clicking the row's label opens its page, clicking the
  rest of the row folds it. One solid triangle is the fold marker everywhere (the fold group's
  button in `components/shell/nav-tree.tsx`).
- **Right rail.** One tenant at a time, two shapes:
  - The **Preview** lives inside the workspace panel. Open, it is the chat card and nothing
    around it: the title row sits on the panel itself, with the toggle sliding in left of the
    title only while the pointer is over the rail. Closed, it is a strip the size of the chat
    card, flush with the panel's right edge; hovering widens it a little over the page and fades
    in the card's left slice. The chat card and its resize handle share one top and bottom,
    pinned by the title row's `h-9`; the closed strip, which has no title row above it, sits
    centred at the same distance from the panel's top and bottom.
  - The **Developer Panel** is the left sidebar mirrored: on the frame, to the right of the
    workspace panel, its handle on the panel's right border, its toggle left of its title.
  - Both open and close on `SPRING_UNFOLD` / `SPRING_REFOLD`, width only, with the content
    keeping its width and sliding out from behind the edge. No fade: the toggle stays visible
    the whole way. The rail toggle is the sidebar toggle mirrored (an icon with a hover wash, its
    arrow turning with the state through `MorphIcon`), not a disc.
  - Anything fixed to the bottom-right offsets by `--right-rail-width`.
- **Resize handles.** A pointer-lit line, no grip. It brightens near the pointer and fades toward
  both ends; `span` limits it to the edge it resizes (the panel, or the chat card) and `cornered`
  lets the light follow that edge round its `rounded-xl` corners when the pointer nears an end.
- **Content follows the panel, not the window.** `main` and the Assistant section column are
  size containers, so page layouts use container queries: `@md:` / `@lg:` / `@3xl:` / `@5xl:` where
  a viewport layout would say `sm:` / `md:` / `lg:` / `xl:` (the viewport step minus the sidebar).
  Opening a rail on either side then reflows the page, which a viewport breakpoint never notices.
  Dialogs are portalled outside `main` and keep viewport breakpoints; so does the shell chrome.
- **A page's committing action lives in the top bar**, beside the breadcrumb, through
  `<SlotPortal id={TOP_BAR_SLOT}>`: "New flow", "Add goal", "Add Help Desk", a Skill's
  Cancel / Save. The page body keeps inline affordances ("Create new flow" at the end of a
  list), never a second primary button.
- **Settings is a dialog over the page you were on.** Opening it from the console is intercepted
  into the admin layout's `@modal` slot (`@modal/(.)settings/*`, each file re-exporting the real
  route), so the page stays underneath and closing returns to it. The sidebar and the breadcrumb
  read `useUnderlyingPathname()`, so Chat stays lit while Settings is open over it. A direct visit
  to `/settings/*` renders the ordinary route. `ModalRouteGate` hides the slot once a link leads
  out of Settings, because a parallel slot keeps its state across a soft navigation it does not
  match.
- **Document pages.** An entity with a long body (a Project, a Skill) is edited as a document, not
  a form in a dialog: a borderless `text-2xl` title line, a one-line description, the body in a
  borderless textarea under a hairline, and optional parts in a boxed section. Focus shows as an
  underline in `ring`. A Skill is a page under Tools & Skills (`…/tools/skills/new|[skillId]`) with
  its Cancel / Save in the top bar.
- **The account menu** (the round button beside New chat) lists Profile, Theme and Sounds as one
  group, no rule between them, each with an 18px animated icon at the item's padding. A row that
  leaves the menu for another surface ends in a small `ArrowUpRight` tile that leans on hover.
  New chat shows its `⌘O` chip only while its container is at least `9rem` wide, so the label
  never wraps.
- **Sticky footers** (a form's save bar) take `z-10` and an opaque ground, or a focused select
  scrolling under them paints over the bar. Inside a padded scroller they stick at minus that
  padding, or text shows through the gap.
- **Forms.** Label above control, `text-sm font-medium` label, `text-muted-foreground text-xs`
  help under the control, character limits shown as `N/limit` in the help line. Unsaved-changes
  guarding through `use-unsaved-changes`.
- **Lists that can be empty** always render `EmptyState` with a sentence that says what will
  appear and, if the user can act, one `Button`.
- **Destructive actions** use the `destructive` variant (a tint, not a red block) and confirm
  through `confirm-delete-modal`. Irreversible bulk actions use `slide-to-confirm`.
- **Loading.** Every admin route has a `loading.tsx` that mirrors its layout, with
  `aria-busy="true"`. Change the page, change the skeleton in the same PR.
- **Scrollbars.** A thin `alpha-strong` thumb on a transparent track everywhere, set once in
  `globals.css` (`scrollbar-color` for Chromium and Firefox, the `::-webkit-scrollbar` pseudos
  for Safari). Do not style a scrollbar per component; hide one with `.no-scrollbar` if it must go.
- **Touch.** Under `lg` and on coarse pointers the admin surface raises icon buttons, selects and
  nav rows to 44px. It does this by `data-slot`, so only the shared primitives get it.

---

## 5. The system as a deep module

In the vocabulary of the `codebase-design` skill, each primitive is a **module**. Its
**interface** is its props plus the facts a caller must know: `variant`, `size`, `tone`,
`render`. Its **implementation** is everything else: token choice, dark mode, focus ring, invalid
state, press feedback, sound, touch-target expansion, forced-colours outline, `data-slot` hooks.

`Badge tone="green"` is deep: one word at the call site buys the hue, both themes, the mist-blue
palette and increased contrast. The hand-written alternative,
`bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400`, is the shallowest
possible module, where the caller writes the whole implementation, gets none of the OS
preferences, and makes a fresh decision every time.

Rules that follow:

1. **The deletion test for a primitive.** Delete it in your head. If the same class string
   reappears at N call sites, it earns its place. If nothing reappears, it is a pass-through;
   inline it.
2. **Add a variant, not a `className`.** When three call sites pass the same override, that
   override is a missing variant or tone. Add it to the primitive's class map (plain
   `Record<Variant, string>`, no `cva`), and delete the overrides in the same change.
3. **`className` is for layout, not appearance.** Margin, width, grid placement: yes. Colour,
   radius, shadow, border: that is the primitive's job, and overriding it is how two buttons stop
   looking alike.
4. **Two modules for one role is a seam with nothing varying across it.** One adapter per role.
   If a motion version is better, it replaces the static one; it does not sit beside it (§6).
5. **Promote on the second app.** A primitive used by one app stays in that app. The moment a
   second app needs it, it moves to `packages/ui`, exported from `src/index.ts`, with a deep path
   declared in `exports` if it has one.
6. **Behaviour gets tested where vitest can reach it.** Vitest collects `.test.ts` only. Put
   interaction logic in a plain `.ts` module beside the component (as `resize-geometry.ts` and
   `sidebar-drag.ts` do) and test that.

---

## 6. Measured drift and the migration list

Counted on 2026-09-29 over `apps/web/src/**/*.tsx`, after the elevation, type and weight
migrations. Not every hit is wrong (a raw colour in a
marketing mock can be deliberate), but each row is where the system is being bypassed.

| Pattern | Hits | Files | System equivalent | Its hits |
|---|---:|---:|---|---:|
| Raw palette colour (`bg-emerald-500`, `text-red-600`, …) | 200 | 42 | `Badge tone`, `text-destructive`, `StatusDot` | 10 |
| `dark:` overrides | 192 | 56 | tokens that flip on their own | n/a |
| `bg-muted` / `border-input` | 397 | 131 | `alpha-*` on controls | 4 |
| `shadow-sm/md/lg/xl/2xl` (product UI) | 0 | 0 | `shadow-light` / `shadow-strong` | 46 |
| `text-[Npx]` (product UI; 14 left in vendored charts) | 0 | 0 | `text-2xs` / `text-xs` | 84 |
| `font-bold` (product UI) | 0 | 0 | `font-semibold` | n/a |
| Raw `gray/zinc/neutral/slate-N` | 65 | 14 | `foreground`, `muted-foreground`, alphas | n/a |
| Hex literals in a class (`bg-[#…]`) | 13 | 5 | tokens (they break mist-blue) | n/a |
| `tracking-tight*` | 28 | 21 | tracking bound to the step | n/a |
| Bare `<button>` | 205 | 96 | `Button`, or `.press-control` | 407 `<Button>` |
| `onClick` handlers vs `press*` utilities | 591 | 161 | `.press` / `.press-control` / `.press-text` | 108 |
| Hand-rolled status dots (`size-2 rounded-full`) | 18 | | `StatusDot` (missing) | 0 |
| Inline bezier in a class string | 1 | 1 | a constant in `lib/ease.ts` | n/a |
| Viewport breakpoints inside `main` (`sm:`–`xl:` on page layouts) | ~113 files | | container queries (§4) | Overview, General, Style, section pages, Insights |

The inline bezier is the Preview title's slide (`cubic-bezier(0.34,1.56,0.64,1)` in
`chat/rail-panel.tsx`): a CSS transition in a class string cannot read the JS constants. It needs a
CSS custom property for the overshoot curve, declared once in `globals.css`.

**Duplicate modules for one role:**

| Role | Kept | Importers | Retire | Importers |
|---|---|---:|---|---:|
| Tabs | `motion/tabs` | 11 | `ui/tabs` | 2 |
| Table | `ui/table` | 13 | `motion/table` | 2 |
| Switch | `ui/motion-switch` | 18 | `ui/switch` | 2 |

`ui/select` is not on the list: it re-exports `motion/select`, so it is one module with two
import paths. "Kept" follows usage. If the retired one has a behaviour the kept one lacks, port it first.

**Order of work**, highest leverage and lowest risk first:

1. **Elevation.** Done: 50 raw shadows moved to the two tokens across `apps/web`,
   `packages/charts`, the docs site and the staff console. The only raw ones left are the
   exemptions in §2.7.
2. **Type below `xs`.** Done: 48 pixel sizes moved to `text-2xs` / `text-xs` / `text-sm`. The
   vendored charts (`charts/beui`) keep theirs, which is also why the mobile
   `[class~="text-[10px]"]` rescue in `globals.css` stays.
3. **`StatusDot` in `packages/ui`.** `tone` prop, solid hue from the tone's ink, `aria-hidden`
   with the label beside it. Replaces status maps like the `ready/processing/error` object in
   `assistant-overview.tsx` and 18 hand-rolled dots.
4. **Status colour → `Badge tone`.** Start from the hotspots: `assistant-overview.tsx` (8),
   `study-exercise.tsx` (7), `activation-status-card.tsx`, `inbox-client.tsx`,
   `flow-step-config.tsx` (5 each). Each fix also deletes its `dark:` twins.
5. **Control surfaces → alphas.** Where `bg-muted`/`border-input` paints a control that can land
   on a card or banner, switch to `bg-alpha-*`/`border-alpha-*`. Leave `bg-muted` on true
   recessed panels.
6. **Collapse the four duplicate pairs** above.
7. **Bare `<button>` → `Button` or `.press-control`**, so touch targets, focus ring and press
   feedback come for free.

**The lint keeps a finished row at zero.** `designTokenRules()` in
[`packages/eslint-config/design-tokens.mjs`](packages/eslint-config/design-tokens.mjs) refuses
`shadow-sm|md|lg|xl|2xl` and `text-[Npx]` in any string literal or template chunk, so `cn(...)`,
ternaries and class maps are covered, not only `className`. The web app, the docs, the staff
console, `packages/ui` and `packages/charts` apply it; the desktop app does not (it has its own
tokens). Exempt folders are passed in by each app: marketing and auth for shadows, the vendored
charts for type. When the next row reaches zero, add its pattern there.

---

## 7. Checklist for a UI change

- [ ] Every colour, border, shadow and radius is a token or comes from a primitive.
- [ ] No new `dark:` class. If you needed one, a token is missing; add it to all three stylesheets.
- [ ] No `text-[Npx]`, no `shadow-md`, no hex, no raw palette colour outside a chart or a status dot.
- [ ] Status uses `Badge tone`, with the mapping in §2.3.
- [ ] Lavender appears only on the committing button, the focus ring or an inline link
      (`text-brand-ink`), and at most one `Button` per view is `default`.
- [ ] Clickable things acknowledge a press (`Button` or a `press*` utility).
- [ ] Icon-only controls have an `aria-label`.
- [ ] Checked in light, dark and mist-blue, and with reduced motion on.
- [ ] `pnpm --filter <app> lint` is clean (the design-token rule runs there).
- [ ] Empty list → `EmptyState`. Page layout changed → its `loading.tsx` changed.
- [ ] A layout inside `main` breaks on the container (`@md:`…`@5xl:`), not the viewport, and was
      checked with both sidebars open.
- [ ] A new side panel opens by width on `SPRING_UNFOLD` / `SPRING_REFOLD` and its handle sits on
      the edge it resizes (`gap`, `span`, `cornered`).
- [ ] A lazily loaded panel is prefetched and rendered directly once loaded, not through
      `next/dynamic` (its first render suspends and React's 300ms reveal throttle delays the open).
      `createPreloader` in `apps/web/src/lib/preloader.ts` does both.
- [ ] Copy is industry-agnostic.
- [ ] A new primitive is in the right place (one app: that app; two apps: `packages/ui` + barrel).
- [ ] If a user can see the change, the docs.ciele.app page that describes it is updated.

---

## 8. What we take from Linear, and what we don't

Linear's published system was the reference for the 2026-09-29 pass. Its marketing canvas is
dark-only and art-directed; the console is a light-and-dark tool used for hours. So the rules
came across and most of the colours did not.

**Taken:**

| Linear rule | Here |
|---|---|
| One chromatic accent, lavender `#5e6ad2`, only on the brand mark, the primary CTA, focus and link emphasis | `brand` tokens, lavender in the console only (§2.1) |
| Focus is a 50% ring of the accent | `--ring: #5e6ad2`, drawn as `ring-ring/50` |
| Display at 600, body at 400, no 700 | No `font-bold` in the console (§2.5) |
| Eyebrows carry positive tracking against negatively tracked headings | The eyebrow recipe (§2.5) |
| 4 / 6 / 8 / 12 / 16 radius steps; controls at 8, cards at 12 | The radius table (§2.6) |
| No atmospheric gradients | The primary button lost its radial glow and hover halo |
| Hairline borders and a faint top highlight carry depth | `alpha-medium` hairlines on Card, Dialog, Input and Textarea, plus the card sheen |
| Buttons 8px radius with generous side padding | `Button` at 12px (`lg` 16px) side padding, same heights |
| Inputs on a lifted surface with a hairline | `Input` / `Textarea` on `alpha-lighter`, 8/12px padding |
| Light, even icon line | Stroke 1.75 in the console (§2.8) |
| Scrollbars that never draw a rail | One global thumb-only rule (§4) |
| The app's frame: a darker ground, the workspace as one rounded, hairlined panel lifted off it, the top bar inside it | `bg-shell` + the workspace panel (§4) |
| Side panels that open by width on one spring and sit on the frame | The sidebar, the Developer Panel and the Preview rail (§4) |
| A panel toggle that appears on hover beside the title, and a collapsed panel as a thin strip | The Preview rail (§4) |
| Selected tab = a surface lift, not a colour | `motion/tabs`' sliding pill |
| A status pill is a lifted neutral, not a saturated block | Already ours: `Badge tone` tints |

The full reference is kept in [`docs/design/linear-reference.md`](docs/design/linear-reference.md).
**It is the direction, not a spec.** When a change is a choice between our current look and
Linear's, lean toward Linear, as long as it keeps what is Ciele's: the light theme and the
palettes, Host Grotesk, the contrast figures, the translucent control alphas, the card sheen and
the press, sound and roll-in feedback.

**Moving toward, not there yet:**

- **Depth without shadow.** Midnight dark now has Linear's surface ladder, but components still
  reach for `shadow-light` / `shadow-strong` where a step up the ladder would do. New surfaces
  should be a step on the ladder first.
- **Hairline tiers.** Linear has three border strengths; we have `alpha-medium` and
  `alpha-strong`. A third (a nested surface's border) would replace ad-hoc `border-foreground/[…]`.

| The near-black canvas `#010102`, the four-step surface ladder, the hairlines `#23252a` / `#34343a`, the ink `#f7f8f8` / `#8a8f98` | Midnight dark in the console (§2.1), every ink pair still AA |

**Not taken, on purpose:**

- **The near-black canvas outside the console.** The marketing site, the docs and the widget keep
  the neutral `.dark` greys, and Mist Blue keeps its own navy grounds.
- **The lighter hover `#828fff` under white text.** 2.9:1 fails WCAG AA; our hover darkens. We use
  `#828fff` where it passes, as link ink on the dark ground.
- **Lavender everywhere Linear is.** Marketing and the docs stay monochrome, as they already were,
  and Mist Blue keeps its navy.
- **The typeface.** Linear's is proprietary; Host Grotesk stays, since it is already ours.
- **Zero tracking at small sizes.** Ours is slightly positive below `text-base`, which reads better
  at the console's 92% density.

