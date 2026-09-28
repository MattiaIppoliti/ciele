"use client";

import { XIcon } from "lucide-react";
import { PlusIcon } from "lucide-react";
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogDescription,
  MorphingDialogSubtitle,
  MorphingDialogTitle,
  MorphingDialogTrigger,
} from "@/components/core/morphing-dialog";
import { Spotlight } from "@/components/core/spotlight";
import { TiltCard } from "@/components/motion/tilt-card";
import type { Feature } from "@/components/home/feature-card-face";

/**
 * The live feature card: tilt, spotlight and the dialog it morphs into.
 *
 * Its own module because all three are `motion/react`, and the cards sit well
 * below the fold: the grid renders the plain face (see `feature-card-face`)
 * and swaps this in when the section comes near, which is what keeps the
 * animation library out of every marketing page's first-load JS.
 */
export function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <MorphingDialog
      transition={{
        type: "spring",
        bounce: 0.05,
        duration: 0.25,
      }}
    >
      {/* TiltCard's `max` is peak-to-peak, so 16 is the 8deg edge tilt. */}
      <TiltCard max={16} glare={false} className="h-full">
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
            ariaLabel={`Learn more about ${feature.title}`}
            className="bg-card flex h-full flex-col overflow-hidden text-left"
          >
            <div className="border-b">{feature.visual(false)}</div>
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
                <span
                  aria-hidden="true"
                  className="border-border text-muted-foreground relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border"
                >
                  <PlusIcon size={12} />
                </span>
              </div>
            </div>
          </MorphingDialogTrigger>
        </div>
      </TiltCard>
      <MorphingDialogContainer>
        <MorphingDialogContent
          style={{ borderRadius: "24px" }}
          ariaLabel={feature.title}
          className="bg-card pointer-events-auto relative flex h-auto w-full flex-col overflow-hidden border sm:w-[500px]"
        >
          <div className="border-b">{feature.visual(true)}</div>
          <div className="p-6">
            <MorphingDialogTitle className="text-foreground text-2xl font-semibold">
              {feature.title}
            </MorphingDialogTitle>
            <MorphingDialogSubtitle className="text-muted-foreground mt-2">
              {feature.body}
            </MorphingDialogSubtitle>
            <MorphingDialogDescription
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
          <MorphingDialogClose className="press-control flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900/50 text-zinc-50 backdrop-blur-sm transition-colors hover:bg-zinc-900/70">
            <XIcon size={16} />
          </MorphingDialogClose>
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  );
}
