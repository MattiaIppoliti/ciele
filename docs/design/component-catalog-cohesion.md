# Component catalog and UI cohesion

The catalog separates atomic components from complete feature blocks. A component
page shows one role and its related variants. A block page shows the controls,
content, and actions that complete a task. Compound APIs retain their required
root and dependent parts.

The integrated catalog contains 151 components and 37 blocks. It preserves the 19
autonomous Overview and Insights blocks, the platform sidebar's resize, rail,
hide, and peek behavior, and the Fit/Compact preview controls. The ArcPicker,
MorphText, and InsightsStatCard added on the PR's newer base have individual pages.

The preservation audit compares the integrated registry with PR #1033's prior
head, `ad543827bc39cf595dfbfcfea5c1e56bf160d004`. All 71 prior family identifiers
and all 196 registered source paths remain available. The 19 autonomous block
entries retain their metadata, variants, sources, and usage examples. No slug or
canonical route is duplicated. Split roles move to dedicated pages; none of the
changed presentation modules loses a named or default export.

```text
/components
├── <slug>                    # one component role
└── blocks
    └── <slug>                # one complete feature
        └── Preview · Usage · Code
```

Old block URLs return HTTP 308 redirects to their canonical routes. Source
snapshots remain available at `/components/<slug>/source` through the existing
allowlist. Components and Blocks have separate search, categories, and previous/
next navigation. Source loading supports cancellation, caching, and retry.

Detail pages pass the family identifier to the client, which already imports
the registry, to avoid serializing the same metadata and examples again. Theme
and tooltip providers share the catalog shell's client boundary. Cookie consent
shares the root interaction boundary and retains its route and consent gates.
The Docker build stage reserves a 4 GB Node heap for compilation of the full app
and static catalog.

## Corrections

The severity column records the resolved issue's severity. The review uses the
Emil design engineering principles and the better-ui recipes requested for this
change. The references are [beUI Input](https://beui.dev/components/motion/input),
[beUI Blocks](https://beui.dev/components/blocks), and
[Board UI Date Picker](https://www.boardui.com/components/date-picker).

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| Resolved HIGH | `apps/web/src/components/motion/input.tsx:20` | Near-white input text on a white surface in dark mode. | Shared Input and Label with paired theme tokens. | The entered value stays readable. |
| Resolved MEDIUM | `apps/web/src/components/motion/input.tsx:8`; `apps/web/src/components/auth/login-form.tsx:11` | Console and authentication inputs use unrelated geometry. | Console density is the default; authentication opts into comfortable density and keeps controlled values on failure. | Defaults fit the task while behavior stays shared. |
| Resolved MEDIUM | `apps/web/src/components/component-catalog/catalog.ts:20`; `apps/web/src/components/component-catalog/primitive-previews.tsx:244` | Label, field headers, headings, charts, and chat roles share mixed previews. | One component role per page; complete tasks have canonical Blocks routes. | The catalog explains which component to choose and how to compose it. |
| Resolved MEDIUM | `apps/web/src/components/settings/field-header.tsx:5`; `apps/web/src/components/assistant/general-form.tsx:345` | General has a separate FieldHeader implementation and uses headings for individual fields. | Shared labels with control and hint associations; headings identify groups. | Field emphasis follows the form hierarchy. |
| Resolved MEDIUM | `apps/web/src/components/settings/section-timeline.tsx:132`; `apps/web/src/components/assistant/voice-settings.tsx:37` | Group boxes, padding, and duplicate Voice headings create nested islands. | Compact field rhythm, an unboxed rail, and embedded Voice content. | Related settings read as one task. |
| Resolved MEDIUM | `apps/web/src/components/ui/section-heading.tsx:10` | Operational headings use large decorative tiles and text entrances. | Console headings are compact and static; marketing presentation is explicit. | Repeated operations need immediate content. |
| Resolved MEDIUM | `apps/web/src/components/ui/switch.tsx:17`; `apps/web/src/components/ui/motion-switch.tsx:1` | Two switch implementations have different default geometry. | One Base UI primitive with explicit default/small sizes; the old import is a compatibility re-export. | State, keyboard, disabled behavior, and feedback stay consistent. |
| Resolved MEDIUM | `packages/ui/src/button.tsx:8`; `apps/web/src/components/motion/button/base.tsx:18`; `apps/web/src/app/globals.css:775`; `apps/web/src/components/agents/{code-block,streaming-response,tool-result}.tsx` | Operational buttons have different press scales, including exaggerated chat controls. | Shared pointer feedback uses scale 0.96 in 100ms, with static, keyboard, and reduced-motion alternatives. | Feedback stays tactile and restrained. |
| Resolved MEDIUM | `apps/web/src/components/motion/input.tsx:43` | Long validation motion, moving error rows, and interrupted shakes can leave an offset. | Reserved error space; 150ms feedback; cancellation clears the captured element's transform. | Validation preserves content and geometry, including when interrupted. |
| Resolved MEDIUM | `apps/web/src/app/globals.css:2011`; `apps/web/src/components/insights/analytics-card.module.css:1` | Analytics/Overview surfaces and nested radii differ across palettes. | Shared theme surfaces, one outer border, and inner radius equal to outer radius minus padding. | Charts, controls, and captions form one coherent surface. |

## Verification scope

The source contract checks unique routes, canonical Blocks paths, all registered
source snapshots, presentation-file coverage, and the 19 autonomous dashboard
blocks. Every usage snippet is compiled against its implementation. Browser
checks cover page loading, mobile overflow, labels, validation, switch keyboard
input, table operations, source retry, redirects, and sidebar behavior.

Pointer feedback is replayed at 10% speed using Chrome's animation protocol.
Clearing an error or enabling reduced motion during a shake restores zero offset.
The validation row keeps its measured height and the typed input value. The audio
example uses a bundled sample; the microphone is disabled without a configured
service.

Not verified: frame-by-frame review in the graphical Animations panel, every
state combination across the entire catalog, physical touch devices, real login,
live voice providers, and every production page. Loading/layout checks do not
approve all interaction states of every component.

**Approve** for the reviewed corrections and inspected surfaces. No confirmed
HIGH or MEDIUM finding remains in that scope; unverified areas are excluded.
