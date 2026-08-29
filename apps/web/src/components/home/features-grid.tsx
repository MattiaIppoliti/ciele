"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import {
  FeatureCardFace,
  VisualSkeleton,
  type Feature,
} from "@/components/home/feature-card-face";
import {
  AmbientActiveContext,
  useOnceInViewport,
  useShouldAnimate,
} from "@/components/home/use-in-viewport";

/* The feature-card visuals pull in motion (via the swipe/upload captions) plus
   the badtz-ui chart components, none of it needed until the below-fold
   Features section is near view. Load each on first approach and render a
   same-height skeleton until then, so nothing weighs on first load and no
   idle animation runs off-screen. (next/dynamic options must be inline object
   literals, the SWC transform reads them statically.) */
const KnowledgeVisual = dynamic(
  () =>
    import("@/components/home/knowledge-visual").then((m) => m.KnowledgeVisual),
  { loading: () => <VisualSkeleton />, ssr: false },
);
const PublishVisual = dynamic(
  () => import("@/components/home/publish-visual").then((m) => m.PublishVisual),
  { loading: () => <VisualSkeleton />, ssr: false },
);
const InsightsVisual = dynamic(
  () =>
    import("@/components/home/insights-visual").then((m) => m.InsightsVisual),
  { loading: () => <VisualSkeleton />, ssr: false },
);

/* The card's own chrome, tilt, spotlight and the dialog it opens into, is
   `motion/react` from end to end, and it lives three screens below the fold.
   The grid renders `FeatureCardFace` (plain markup, server-rendered) until the
   section is near view and swaps this in there, which is what takes the
   animation library off every public page's first load. */
const FeatureCard = dynamic(
  () => import("@/components/home/feature-card").then((m) => m.FeatureCard),
  { ssr: false },
);

const FEATURES: Feature[] = [
  {
    title: "Answers from your knowledge",
    body: "Connect websites, help centers, files and FAQs. Assistants ground every answer in your organization's own content.",
    visual: () => <KnowledgeVisual />,
    details: [
      "Point an assistant at your websites and knowledge bases. Ciele crawls them and re-indexes on a schedule, so answers stay current without manual upkeep. Upload files or curate FAQs to fine-tune how specific questions are handled.",
      "Every AI answer cites the sources behind it, so your team can trace a response back to the exact page or document it came from.",
    ],
  },
  {
    title: "Publish everywhere",
    body: "One assistant, many channels: your website, internal portals and a shareable embed, edited live with an instant preview.",
    visual: () => <PublishVisual />,
    details: [
      "Edit your assistant side-by-side with a live preview of the widget, then publish the same assistant to every channel you need: a floating launcher on your website, an embedded iframe, or internal portals.",
      "You set the colors, launcher icon, position and typography, so the widget matches the page it sits on instead of announcing itself.",
    ],
  },
  {
    title: "Insights, not guesswork",
    body: "Track resolution rate, answer ratings and conversation trends, see how your assistants perform and where to improve.",
    visual: () => <InsightsVisual />,
    details: [
      "One live dashboard shows AI resolution rate, thumbs-up/down ratings, escalations, unique users and CSAT, all filterable by assistant, channel and date range.",
      "Generate AI trend reports over any window and export the underlying data, so you know which answers to improve next.",
    ],
  },
];

export function FeaturesGrid() {
  // Observe the (non-transformed) grid, the cards themselves are Tilt-
  // transformed, where IntersectionObserver can't read their own visibility.
  // `mounted` (sticky) defers the lazy visuals until the section is near view;
  // `active` pauses the visuals' idle loops whenever the section is off screen
  // (or reduced-motion is on), delivered to them via AmbientActiveContext.
  const gridRef = useRef<HTMLDivElement>(null);
  const mounted = useOnceInViewport(gridRef, { rootMargin: "400px 0px" });
  const active = useShouldAnimate(gridRef, { rootMargin: "200px 0px" });

  return (
    <AmbientActiveContext.Provider value={active}>
      {/* grid-cols-1 is not cosmetic: without it the single-column stack uses an
          implicit `auto` track, whose auto min sizing lets each card grow to its
          content-based minimum, the card visuals are a fixed 356px wide, so the
          cards ran ~30px past the right edge of a phone viewport. An explicit
          minmax(0,1fr) column (what grid-cols-1 emits, same as md:grid-cols-3)
          zeroes that minimum, so the card fits and clips its visual instead. */}
      <div ref={gridRef} className="mt-14 grid grid-cols-1 gap-8 md:grid-cols-3">
        {FEATURES.map((feature) =>
          mounted ? (
            <FeatureCard key={feature.title} feature={feature} mounted />
          ) : (
            <FeatureCardFace key={feature.title} feature={feature} />
          )
        )}
      </div>
    </AmbientActiveContext.Provider>
  );
}
