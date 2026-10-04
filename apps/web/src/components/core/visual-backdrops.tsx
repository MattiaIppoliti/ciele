/** Shared backdrops for the two 356 × 180 marketing illustrations. */
export function VisualEllipse({ color }: { color: string }) {
  return (
    <div
      className="absolute inset-0 z-[5]"
      style={{
        backgroundImage: `radial-gradient(ellipse 178px 98px at 50% 98px, color-mix(in srgb, ${color} 25%, transparent), color-mix(in srgb, ${color} 15%, transparent) 34%, transparent)`,
      }}
    />
  );
}

export function VisualGradient({ color }: { color: string }) {
  return (
    <div
      className="absolute inset-0 z-[6] translate-y-full opacity-0 transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.6,0.6,0,1)] motion-reduce:transition-none group-hover/animated-card:translate-y-0 group-hover/animated-card:opacity-100"
      style={{
        backgroundImage: `linear-gradient(to bottom, transparent 35%, color-mix(in srgb, ${color} 30%, transparent))`,
      }}
    />
  );
}

export function VisualGrid({ color }: { color: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[4] bg-[size:20px_20px] bg-center opacity-70 [mask-image:radial-gradient(ellipse_50%_50%_at_50%_50%,#000_60%,transparent_100%)]"
      style={{
        backgroundImage: `linear-gradient(to right, ${color} 1px, transparent 1px), linear-gradient(to bottom, ${color} 1px, transparent 1px)`,
      }}
    />
  );
}
