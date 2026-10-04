export type CelebrationVariant = "default" | "fireworks";

/** Optional visual feedback must never turn a successful operation into an error. */
export async function celebrate(variant: CelebrationVariant = "default"): Promise<void> {
  if (typeof window === "undefined" || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    const { default: confetti } = await import("canvas-confetti");
    if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = document.createElement("canvas");
    canvas.dataset.celebration = variant;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:100";
    document.body.append(canvas);
    const fire = confetti.create(canvas, { resize: true, disableForReducedMotion: true });
    try {
      if (variant === "fireworks") {
        await Promise.all([
          fire({ particleCount: 55, spread: 360, startVelocity: 28, ticks: 140, origin: { x: 0.25, y: 0.35 } }),
          fire({ particleCount: 55, spread: 360, startVelocity: 28, ticks: 140, origin: { x: 0.75, y: 0.35 } }),
        ]);
      } else {
        await fire({ particleCount: 100, spread: 75, startVelocity: 38, ticks: 180, origin: { x: 0.5, y: 0.65 } });
      }
    } finally { fire.reset(); canvas.remove(); }
  } catch { /* A blocked optional animation leaves the successful result intact. */ }
}
