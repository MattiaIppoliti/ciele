"use client";

import { PlusIcon, XIcon } from "lucide-react";
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
  VisualSkeleton,
  type Feature,
} from "@/components/home/feature-card-face";

/**
 * The live feature card: tilt, spotlight and the dialog it morphs into.
 *
 * Its own module because all three are `motion/react`, and the cards sit well
 * below the fold: the grid renders the plain face (see `feature-card-face`)
 * and swaps this in when the section comes near, which is what keeps the
 * animation library out of every marketing page's first-load JS.
 */
export function FeatureCard({
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
              vanish, sit it on a dark translucent chip for contrast on any
              image. */}
          <MorphingDialogClose className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900/50 text-zinc-50 backdrop-blur-sm transition-colors hover:bg-zinc-900/70">
            <XIcon size={16} />
          </MorphingDialogClose>
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  );
}
