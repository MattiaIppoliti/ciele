import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * What a feature card looks like before anything animates: the same face, with
 * no tilt, no spotlight and no dialog.
 *
 * The grid renders this until the section is near the viewport, then swaps in
 * the live card (see `feature-card.tsx`). Same box, same type, same order, so
 * the swap is invisible and the card's words are in the server-rendered HTML
 * either way.
 */
export interface Feature {
  title: string;
  body: string;
  /** Screenshot of the matching surface inside the product. */
  image?: string;
  /**
   * Live mock rendered instead of `image` (e.g. an animated uploader). Receives
   * `interactive`: false in the card face, true in the expanded dialog.
   */
  visual?: (interactive: boolean) => ReactNode;
  details: string[];
}

/** Height-matched placeholder for a not-yet-loaded card visual, keeps the
 * card face stable so the swap causes no layout shift. */
export function VisualSkeleton() {
  return <div aria-hidden className="bg-card h-[180px] w-full" />;
}

export function FeatureCardFace({ feature }: { feature: Feature }) {
  return (
    <div className="relative h-full overflow-hidden rounded-2xl bg-zinc-300/30 p-px dark:bg-zinc-700/30">
      <div
        style={{ borderRadius: "15px" }}
        className="bg-card flex h-full flex-col overflow-hidden text-left"
      >
        {feature.visual ? (
          <div className="border-b">
            <VisualSkeleton />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={feature.image ?? ""}
            alt={`${feature.title} | Ciele`}
            className="h-44 w-full border-b object-cover object-top"
          />
        )}
        <div className="flex grow flex-col p-5">
          <div className="flex grow flex-col">
            <h3 className="text-foreground font-medium">{feature.title}</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
              {feature.body}
            </p>
          </div>
          <div className="mt-4 flex justify-end">
            <span
              aria-hidden
              className="border-border text-muted-foreground relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border"
            >
              <PlusIcon size={12} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
