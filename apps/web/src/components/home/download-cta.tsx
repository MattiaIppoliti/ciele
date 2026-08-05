"use client";

import { ArrowRight, Check, Zap } from "lucide-react";
import { useId, useState } from "react";
import { GhostMark } from "@/components/auth/ghost-mark";
import {
  ExpandableScreen,
  ExpandableScreenContent,
  ExpandableScreenTrigger,
} from "@/components/ui/expandable-screen";

const fieldClassName =
  "w-full rounded-lg border-0 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-all placeholder:text-zinc-400 focus:ring-2 focus:ring-white/60";

const labelClassName =
  "mb-2 block text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-400";

export function DownloadCta() {
  const nameId = useId();
  const emailId = useId();
  const orgId = useId();
  const teamSizeId = useId();
  const excitedId = useId();
  const [submitted, setSubmitted] = useState(false);

  return (
    <ExpandableScreen
      layoutId="download-cta"
      triggerRadius="18px"
      contentRadius="28px"
    >
      <div className="mb-20 flex justify-center">
        {/* data-cursor-more: over this button the home cursor morphs into the
            "More +" pill, same as the feature cards. Tight inline-flex wrapper
            so the hover zone matches the button, not the centered row. */}
        <span data-cursor-more className="inline-flex">
          <ExpandableScreenTrigger className="group flex items-center gap-3.5 bg-zinc-900 p-2.5 pr-6 shadow-sm shadow-zinc-950/10 transition-colors duration-300 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700">
            <span className="flex size-9 items-center justify-center rounded-[8px] bg-white">
              <GhostMark className="size-7" />
            </span>
            <span className="text-lg font-medium text-white">
              Download Ciele
            </span>
            <ArrowRight className="size-5 text-zinc-400 transition-transform duration-300 group-hover:translate-x-0.5" />
          </ExpandableScreenTrigger>
        </span>
      </div>

      <ExpandableScreenContent className="bg-zinc-950 text-white">
        <div className="mx-auto flex h-full w-full max-w-[1100px] flex-col items-center gap-8 p-6 sm:p-10 lg:flex-row lg:gap-16 lg:p-16">
          {/* Left: value proposition for the desktop app early access. */}
          <div className="flex w-full flex-1 flex-col justify-center space-y-6">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-[14px] bg-white shadow-sm">
                <GhostMark className="size-9" />
              </span>
              <span className="text-sm font-medium uppercase tracking-[0.08em] text-zinc-400">
                Desktop app · Early access
              </span>
            </div>

            <h2 className="text-3xl font-medium leading-none tracking-[-0.03em] sm:text-4xl lg:text-5xl">
              Get early access to the Ciele desktop app
            </h2>

            <p className="max-w-md text-base leading-[160%] text-zinc-300">
              Bring your assistants to the desktop, build, test and publish from
              a native app. Join the list and we&apos;ll send your download link
              as soon as your spot opens up.
            </p>

            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-4">
                <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Zap className="size-5" />
                </div>
                <p className="text-sm leading-[150%] text-zinc-300">
                  Priority access to the native app and new features before
                  public release.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Check className="size-5" />
                </div>
                <p className="text-sm leading-[150%] text-zinc-300">
                  Shape the roadmap, early testers help decide what ships next.
                </p>
              </div>
            </div>
          </div>

          {/* Right: waitlist form (client-side; not yet persisted). */}
          <div className="w-full flex-1">
            {submitted ? (
              <div className="flex flex-col items-start gap-3 rounded-2xl bg-white/5 p-8">
                <div className="flex size-12 items-center justify-center rounded-full bg-white/10">
                  <Check className="size-6" />
                </div>
                <h3 className="text-2xl font-medium tracking-[-0.02em]">
                  You&apos;re on the list
                </h3>
                <p className="text-sm leading-[160%] text-zinc-300">
                  Thanks for signing up. We&apos;ll email your download link when
                  your early-access spot is ready.
                </p>
              </div>
            ) : (
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSubmitted(true);
                }}
              >
                <div>
                  <label htmlFor={nameId} className={labelClassName}>
                    Full name *
                  </label>
                  <input
                    type="text"
                    id={nameId}
                    name="name"
                    required
                    autoComplete="name"
                    defaultValue="Bruce Wayne"
                    className={fieldClassName}
                  />
                </div>

                <div>
                  <label htmlFor={emailId} className={labelClassName}>
                    Work email *
                  </label>
                  <input
                    type="email"
                    id={emailId}
                    name="email"
                    required
                    autoComplete="email"
                    defaultValue="brucewayne@batman.com"
                    className={fieldClassName}
                  />
                </div>

                <div>
                  <label htmlFor={orgId} className={labelClassName}>
                    Name of the organization
                  </label>
                  <input
                    type="text"
                    id={orgId}
                    name="organization"
                    autoComplete="organization"
                    defaultValue="Batman ®"
                    className={`${fieldClassName} text-zinc-400`}
                  />
                </div>

                <div>
                  <label htmlFor={teamSizeId} className={labelClassName}>
                    Team size
                  </label>
                  <select
                    id={teamSizeId}
                    name="team-size"
                    defaultValue=""
                    className={fieldClassName}
                  >
                    <option value="" disabled>
                      Select
                    </option>
                    <option value="1-50">1 to 50</option>
                    <option value="50-500">50 to 500</option>
                    <option value="500-5000">500 to 5000</option>
                    <option value="5000+">5000+</option>
                  </select>
                </div>

                <div>
                  <label htmlFor={excitedId} className={labelClassName}>
                    What are you most excited about?
                  </label>
                  <textarea
                    id={excitedId}
                    name="excited-about"
                    rows={3}
                    placeholder="Tell us what you're looking forward to…"
                    className={`${fieldClassName} resize-none`}
                  />
                </div>

                <button
                  type="submit"
                  className="h-11 w-full rounded-full bg-white px-8 font-medium tracking-[-0.02em] text-zinc-900 transition-colors hover:bg-white/90"
                >
                  Join the waitlist
                </button>
              </form>
            )}
          </div>
        </div>
      </ExpandableScreenContent>
    </ExpandableScreen>
  );
}
