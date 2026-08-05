/* The Resources card's artwork: a folder whose sheets lift out and whose front
   tips forward when the card is hovered.

   Built from plain boxes rather than the source's exported folder path. That
   path is drawn at 236x122 and the slot it fills here is far wider and much
   shorter, so fitting it meant `preserveAspectRatio="none"`, which smeared the
   corner radii and the tab. Rectangles carry their own radii and take any
   aspect ratio without distorting.

   Every colour is `currentColor` at varying opacity plus `--muted`, so the
   folder is the same greys as the rest of the nav in both themes. It opens on
   the card's hover, because the card is a link and a click has somewhere else
   to be, so this is CSS transitions off `group/card` with no state and no
   motion library. */

/** One sheet of paper: a ruled block, drawn in the surrounding grey. */
function Sheet() {
  return (
    <span className="border-muted-foreground/15 bg-muted block rounded-md border p-1.5 shadow-sm">
      <span className="bg-muted-foreground/25 mb-1 block h-0.5 w-2/3 rounded-full" />
      {Array.from({ length: 4 }).map((_, row) => (
        <span key={row} className="mb-1 flex gap-1 last:mb-0">
          <span className="bg-muted-foreground/20 h-0.5 flex-1 rounded-full" />
          <span className="bg-muted-foreground/20 h-0.5 flex-1 rounded-full" />
        </span>
      ))}
    </span>
  );
}

export function FolderVisual() {
  return (
    <span className="text-muted-foreground/70 relative mt-3 block h-28 w-full [perspective:320px]">
      {/* Back of the folder, with its tab. */}
      <span className="absolute inset-x-5 bottom-1 top-4 rounded-xl border border-current/15 bg-current/8" />
      <span className="absolute left-5 top-2 h-3 w-16 rounded-t-lg border border-b-0 border-current/15 bg-current/8" />

      {/* Three sheets, tucked in at rest. The middle one leads on the way out,
          the outer two fan wider as they lift. */}
      <span className="absolute inset-x-0 bottom-6 flex h-14 items-end justify-center">
        <span className="absolute bottom-0 w-[4.5rem] -translate-x-9 rotate-[-4deg] duration-500 ease-out group-hover/card:-translate-x-14 group-hover/card:-translate-y-5 group-hover/card:rotate-[-11deg]">
          <Sheet />
        </span>
        <span className="absolute bottom-1 w-[4.5rem] duration-500 ease-out group-hover/card:-translate-y-7">
          <Sheet />
        </span>
        <span className="absolute bottom-0 w-[4.5rem] translate-x-9 rotate-[4deg] duration-500 ease-out group-hover/card:translate-x-14 group-hover/card:-translate-y-5 group-hover/card:rotate-[11deg]">
          <Sheet />
        </span>
      </span>

      {/* Front of the folder: opaque, so the sheets tuck behind it, and hinged
          on its bottom edge so they read as coming out rather than sliding
          behind. Only the hovered state sets a transform, since pairing it with
          an explicit `rotateX(0deg)` base put two same-specificity rules in
          play and the base won on hover. */}
      <span className="bg-muted absolute inset-x-3 bottom-1 h-14 origin-bottom overflow-hidden rounded-lg rounded-t-md border border-current/25 shadow-[0_-8px_20px_-8px_rgba(0,0,0,0.35)] duration-500 ease-out group-hover/card:[transform:rotateX(-42deg)]">
        <span className="absolute inset-0 bg-gradient-to-b from-current/20 to-current/5" />
        <span className="absolute inset-x-3 top-1.5 block h-px bg-current/20" />
      </span>
    </span>
  );
}
