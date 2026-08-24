// The multi-step-form shell: step title and description, dot progress,
// animated height, directional slide between steps.
//
// The animation is pure CSS. Each step remounts (`key={currentStep}`), so
// `@starting-style` (Tailwind's `starting:` variant) gives the fresh element
// its entry state, and `interpolate-size: allow-keywords` lets the height
// transition run to `auto`, which replaces the old motion + react-use-measure
// height spring.

import type { ReactNode } from "react";
import { cn } from "../lib/cn";

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
  return (
    <div className="flex w-full items-center justify-center p-4">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-lg shadow-black/20">
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

        <div className="relative overflow-hidden px-6 py-2">
          <div
            key={currentStep}
            data-testid="wizard-step"
            className={cn(
              "w-full overflow-hidden",
              "h-auto translate-x-0 opacity-100",
              "[interpolate-size:allow-keywords] transition-[height,translate,opacity] duration-500 ease-out",
              "starting:h-0 starting:opacity-0",
              direction >= 0
                ? "starting:translate-x-[110%]"
                : "starting:translate-x-[-110%]",
            )}
          >
            {children}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
          {footer}
        </footer>
      </div>
    </div>
  );
}
