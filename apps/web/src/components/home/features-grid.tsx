"use client";

import { PlusIcon, XIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, type ReactNode } from "react";
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogDescription,
  MorphingDialogImage,
  MorphingDialogSubtitle,
  MorphingDialogTitle,
  MorphingDialogTrigger,
} from "@/components/core/morphing-dialog";
import { Spotlight } from "@/components/core/spotlight";
import { Tilt } from "@/components/core/tilt";
import {
  AmbientActiveContext,
  useOnceInViewport,
  useShouldAnimate,
} from "@/components/home/use-in-viewport";

/** Height-matched placeholder for a not-yet-loaded card visual — keeps the
 * card face stable so the swap causes no layout shift. */
function VisualSkeleton() {
  return <div aria-hidden className="bg-card h-[180px] w-full" />;
}

/* The feature-card visuals pull in motion (via the swipe/upload captions) plus
   the badtz-ui chart components — none of it needed until the below-fold
   Features section is near view. Load each on first approach and render a
   same-height skeleton until then, so nothing weighs on first load and no
   idle animation runs off-screen. (next/dynamic options must be inline object
   literals — the SWC transform reads them statically.) */
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

interface Feature {
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

const FEATURES: Feature[] = [
  {
    title: "Answers from your knowledge",
    body: "Connect websites, help centers, files and FAQs. Assistants ground every answer in your organization's own content.",
    visual: () => <KnowledgeVisual />,
    details: [
      "Point an assistant at your websites and knowledge bases and they are crawled and re-indexed automatically, so answers stay current without manual upkeep. Upload files or curate FAQs to fine-tune how specific questions are handled.",
      "Every AI answer cites the sources it was grounded in, so your team can always trace a response back to the exact page or document it came from.",
    ],
  },
  {
    title: "Publish everywhere",
    body: "One assistant, many channels: your website, internal portals and a shareable embed, edited live with an instant preview.",
    visual: () => <PublishVisual />,
    details: [
      "Edit your assistant side-by-side with a live preview of the widget, then publish the same assistant to every channel you need: a floating launcher on your website, an embedded iframe, or internal portals.",
      "Appearance is fully yours, colors, launcher icon, position and typography, so the widget feels native wherever it lives.",
    ],
  },
  {
    title: "Insights, not guesswork",
    body: "Track resolution rate, answer ratings and conversation trends, see how your assistants perform and where to improve.",
    visual: () => <InsightsVisual />,
    details: [
      "A live dashboard surfaces the metrics that matter: AI resolution rate, thumbs-up/down ratings, escalations, unique users and CSAT, all filterable by assistant, channel and date range.",
      "Generate AI trend reports over any window and export the underlying data, so you always know which answers to improve next.",
    ],
  },
];

function FeatureCard({
  feature,
  mounted,
}: {
  feature: Feature;
  /** Once the Features section is near view, render the real (lazy) visual;
   * until then a same-height skeleton stands in so nothing loads/animates. */
  mounted: boolean;
}) {
  return (
    <MorphingDialog
      transition={{
        type: "spring",
        bounce: 0.05,
        duration: 0.25,
      }}
    >
      <Tilt
        rotationFactor={8}
        isRevese
        springOptions={{ stiffness: 300, damping: 30 }}
        className="h-full"
      >
        {/* Spotlight border glow: the wrapper's translucent bg reads as the
            card border; the cursor-following glow shines through the 1px
            inset around the opaque trigger on top. data-feature-card marks the
            hover zone that morphs the home cursor into a "More +" pill. */}
        <div
          data-feature-card
          className="relative h-full overflow-hidden rounded-2xl bg-zinc-300/30 p-px dark:bg-zinc-700/30"
        >
          <Spotlight
            className="from-sky-400 via-indigo-500 to-transparent dark:from-sky-300 dark:via-indigo-400 blur-2xl"
            size={220}
          />
          <MorphingDialogTrigger
            style={{ borderRadius: "15px" }}
            className="bg-card flex h-full flex-col overflow-hidden text-left"
          >
            {feature.visual ? (
              <div className="border-b">
                {mounted ? feature.visual(false) : <VisualSkeleton />}
              </div>
            ) : (
              <MorphingDialogImage
                src={feature.image ?? ""}
                alt={`${feature.title} | Ciele`}
                className="h-44 w-full border-b object-cover object-top"
              />
            )}
            <div className="flex grow flex-col p-5">
              <div className="flex grow flex-col">
                <MorphingDialogTitle className="text-foreground font-medium">
                  {feature.title}
                </MorphingDialogTitle>
                <MorphingDialogSubtitle className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {feature.body}
                </MorphingDialogSubtitle>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  tabIndex={-1}
                  className="border-border text-muted-foreground hover:bg-accent hover:text-foreground relative flex h-6 w-6 shrink-0 scale-100 select-none appearance-none items-center justify-center rounded-lg border transition-colors focus-visible:ring-2 active:scale-[0.98]"
                  aria-label="Open dialog"
                >
                  <PlusIcon size={12} />
                </button>
              </div>
            </div>
          </MorphingDialogTrigger>
        </div>
      </Tilt>
      <MorphingDialogContainer>
        <MorphingDialogContent
          style={{ borderRadius: "24px" }}
          className="bg-card pointer-events-auto relative flex h-auto w-full flex-col overflow-hidden border sm:w-[500px]"
        >
          {feature.visual ? (
            <div className="border-b">{feature.visual(true)}</div>
          ) : (
            <MorphingDialogImage
              src={feature.image ?? ""}
              alt={`${feature.title} | Ciele`}
              className="w-full border-b object-cover"
            />
          )}
          <div className="p-6">
            <MorphingDialogTitle className="text-foreground text-2xl font-semibold">
              {feature.title}
            </MorphingDialogTitle>
            <MorphingDialogSubtitle className="text-muted-foreground mt-2">
              {feature.body}
            </MorphingDialogSubtitle>
            <MorphingDialogDescription
              disableLayoutAnimation
              variants={{
                initial: { opacity: 0, scale: 0.8, y: 100 },
                animate: { opacity: 1, scale: 1, y: 0 },
                exit: { opacity: 0, scale: 0.8, y: 100 },
              }}
            >
              {feature.details.map((paragraph) => (
                <p
                  key={paragraph}
                  className="text-muted-foreground mt-4 text-sm leading-relaxed"
                >
                  {paragraph}
                </p>
              ))}
            </MorphingDialogDescription>
          </div>
          {/* Screenshots have a light top bar, so a bare white X would
              vanish — sit it on a dark translucent chip for contrast on any
              image. */}
          <MorphingDialogClose className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900/50 text-zinc-50 backdrop-blur-sm transition-colors hover:bg-zinc-900/70">
            <XIcon size={16} />
          </MorphingDialogClose>
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  );
}

export function FeaturesGrid() {
  // Observe the (non-transformed) grid — the cards themselves are Tilt-
  // transformed, where IntersectionObserver can't read their own visibility.
  // `mounted` (sticky) defers the lazy visuals until the section is near view;
  // `active` pauses the visuals' idle loops whenever the section is off screen
  // (or reduced-motion is on), delivered to them via AmbientActiveContext.
  const gridRef = useRef<HTMLDivElement>(null);
  const mounted = useOnceInViewport(gridRef, { rootMargin: "400px 0px" });
  const active = useShouldAnimate(gridRef, { rootMargin: "200px 0px" });

  return (
    <AmbientActiveContext.Provider value={active}>
      <div ref={gridRef} className="mt-14 grid gap-8 md:grid-cols-3">
        {FEATURES.map((feature) => (
          <FeatureCard key={feature.title} feature={feature} mounted={mounted} />
        ))}
      </div>
    </AmbientActiveContext.Provider>
  );
}
