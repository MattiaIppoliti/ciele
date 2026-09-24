# Layers and paint order

There is no track index. Stacking is **DOM order inside an `<AbsoluteFill>`**: later siblings paint over earlier ones.

```tsx
<AbsoluteFill>
  <Background />      {/* bottom */}
  <Scenes />
  <Grain />
  <Captions />        {/* top */}
</AbsoluteFill>
```

Read the assembly top-to-bottom as back-to-front. This replaces the old `data-track-index` numbering, and it removes the class of bug where two elements shared an index and fought.

## Reach for `zIndex` only to break flow order

If you find yourself setting `zIndex` on siblings, reorder them instead, because the order is the documentation. `zIndex` is justified when the element that must sit on top cannot move in the tree, for example a scene-local overlay that has to clear a sibling established by a shared wrapper.

`zIndex` also only works between siblings in the same stacking context. Setting `zIndex: 999` on something nested two levels down does not lift it above its parent's sibling.

## Overlapping two scenes

Two scenes on the same span are two `<Sequence>` siblings with overlapping ranges. The later sibling paints on top:

```tsx
<AbsoluteFill>
  <Sequence from={0} durationInFrames={120}><Outgoing /></Sequence>
  <Sequence from={105} durationInFrames={120}><Incoming /></Sequence>
</AbsoluteFill>
```

For the 15-frame overlap to read as a crossfade, `Incoming` fades its own root in from 0. Do not fade `Outgoing` out at the same time unless you want the background to show through the middle of the dip, which on a dark film reads as a flash. `/seam-craft` covers the guard.

Prefer `<Series>` with a negative `offset`, or `<TransitionSeries>`, over hand-placed overlapping `from` values. Hand-placed offsets stop agreeing with the storyboard the first time a duration changes.

## Full-frame backgrounds

A scene's ground goes on a full-bleed child, not on the composition root:

```tsx
<AbsoluteFill>
  <AbsoluteFill style={{ backgroundColor: "#0B0D12" }} />
  <Content />
</AbsoluteFill>
```

One `<AbsoluteFill>` for the fill, siblings on top. This keeps the fill inside the scene's own mount window, so it disappears when the scene unmounts instead of persisting under the next one.

## Transparent renders

For an overlay deliverable, render with a codec that carries alpha (`--codec=prores --prores-profile=4444`, or WebM/VP8) and paint **no** background anywhere in the tree. A single opaque `<AbsoluteFill>` left in a wrapper flattens the alpha for the whole film, and the failure is invisible until someone composites it.

## Mounting is what stops a layer painting

An element unmounts at the end of its `<Sequence>`'s `durationInFrames`. Without a duration it stays mounted to the end of the composition and keeps painting over everything after it. That is the most common cause of "why is scene 1's title still on screen".

Never animate `display` or use `visibility` to hide a finished layer. Unmount it by bounding its `<Sequence>`.
