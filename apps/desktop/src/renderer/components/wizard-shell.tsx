// The multi-step-form shell, kept as supplied: step title and description,
// dot progress, animated height, directional slide between steps.
//
// The demo's fields are gone: this wizard's steps do work rather than collect
// a form, but the chrome is the point, and it is unchanged: `useMeasure` on
// the content drives the height spring, and `AnimatePresence` with a custom
// `direction` gives the slide its sense of travel.

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import useMeasure from "react-use-measure";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

const variants = {
  initial: (direction: number) => ({ x: `${110 * direction}%`, opacity: 0 }),
  animate: { x: "0%", opacity: 1 },
  exit: (direction: number) => ({ x: `${-110 * direction}%`, opacity: 0 }),
};

export function WizardShell({
  title,
  description,
  stepCount,
  currentStep,
  direction,
  footer,
  children,
}: {
  title: string;
  description: string;
  stepCount: number;
  currentStep: number;
  /** 1 forward, -1 back, what gives the slide its direction. */
  direction: number;
  footer: ReactNode;
  children: ReactNode;
}): ReactNode {
  const [ref, bounds] = useMeasure();

  return (
    <MotionConfig transition={{ duration: 0.5, type: "spring", bounce: 0 }}>
      <div className="flex w-full items-center justify-center p-4">
        <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-lg shadow-black/20">
          <motion.div layout>
            <header className="flex flex-row items-start justify-between gap-4 px-6 py-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-xl font-semibold" data-testid="wizard-title">
                  {title}
                </h1>
                <p className="text-sm text-ink-muted">{description}</p>
              </div>
              <div className="flex items-center gap-1.5 pt-2">
                {Array.from({ length: stepCount }, (_, index) => (
                  <div
                    key={index}
                    className={cn(
                      "h-2 rounded-full transition-all duration-300",
                      currentStep === index ? "w-8 bg-accent" : "w-2 bg-accent/20",
                    )}
                  />
                ))}
              </div>
            </header>

            <motion.div
              animate={{ height: bounds.height > 0 ? bounds.height : "auto" }}
              className="relative overflow-hidden"
              transition={{ type: "spring", bounce: 0, duration: 0.5 }}
            >
              <div ref={ref}>
                <div className="relative px-6 py-2">
                  <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                    <motion.div
                      key={currentStep}
                      variants={variants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="w-full"
                      custom={direction}
                      data-testid="wizard-step"
                    >
                      {children}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>

            <footer className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
              {footer}
            </footer>
          </motion.div>
        </div>
      </div>
    </MotionConfig>
  );
}
