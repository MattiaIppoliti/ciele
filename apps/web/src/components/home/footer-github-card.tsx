"use client";

import { RollingNumber } from "@/components/motion/rolling-number";

import { RollInText } from "@/components/motion/roll-in-text";


// Adapted from Saurabh Sharma's Great UI Github Card.
// https://great-ui.com/components/github-card — Great UI Custom License Agreement.
import { useEffect, useState, type PointerEvent } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { z } from "zod";
import styles from "./footer-github-card.module.css";
import { FOOTER_GITHUB_PROFILE, type FooterGithubProfile } from "@/lib/marketing/github-profile";


const activitySchema = z.object({
  contributions: z.array(z.object({
    date: z.iso.date(),
    count: z.number().int().nonnegative(),
    level: z.number().int().min(0).max(4),
  })),
});
type Day = z.infer<typeof activitySchema>["contributions"][number];
let activityRequest: Promise<Day[]> | undefined;

function loadActivity(username: string) {
  activityRequest ??= fetch(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(username)}?y=last`, {
    signal: AbortSignal.timeout(10_000),
  }).then(async (response) => {
    if (!response.ok) throw new Error("GitHub activity unavailable");
    const data = activitySchema.parse(await response.json());
    const today = new Date().toISOString().slice(0, 10);
    const days = data.contributions.filter((day) => day.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date)).slice(-119);
    if (!days.length) throw new Error("GitHub activity unavailable");
    return days;
  });
  return activityRequest;
}

export function FooterGithubCard() {
  return FOOTER_GITHUB_PROFILE ? <GithubProfileCard profile={FOOTER_GITHUB_PROFILE} /> : null;
}

function GithubProfileCard({ profile }: { profile: FooterGithubProfile }) {
  const PROFILE = `https://github.com/${profile.username}`;
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState<Day[] | null>(null);
  const [failed, setFailed] = useState(false);
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(x, { stiffness: 300, damping: 20 });
  const rotateY = useSpring(y, { stiffness: 300, damping: 20 });

  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadActivity(profile.username).then(
      (days) => { if (active) setActivity(days); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [open, profile.username]);

  function tilt(event: PointerEvent<HTMLElement>) {
    if (reducedMotion || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(-((event.clientY - rect.top) / rect.height - 0.5) * 10);
    y.set(((event.clientX - rect.left) / rect.width - 0.5) * 10);
  }

  function close() {
    setOpen(false);
    x.set(0);
    y.set(0);
  }

  return (
    <div className={styles.root}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setOpen(true); }}
      onPointerLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) close(); }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}
    >
      <span>Follow me on </span>
      <a className="press-text underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4"
        href={PROFILE} target="_blank" rel="noopener noreferrer">GitHub</a>
      <AnimatePresence>
        {open && (
          <motion.div className={styles.card} aria-label={`${profile.name} on GitHub`} role="region"
            initial={{ opacity: 0, y: reducedMotion ? 0 : 6, scale: reducedMotion ? 1 : 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
            style={{ rotateX, rotateY }} onPointerMove={tilt}
            onPointerLeave={() => { x.set(0); y.set(0); }}
          >
            <div className="mb-4 flex items-center gap-4">
              {/* External public profile image, loaded only when the preview opens. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${PROFILE}.png?size=96`} alt="" width={48} height={48}
                className="border-border size-12 rounded-full border object-cover" />
              <div className="min-w-0">
                <p className="text-foreground text-base font-semibold"><RollInText text={profile.name} /></p>
                <a href={PROFILE} target="_blank" rel="noopener noreferrer"
                  className="press-text text-sm hover:text-foreground">@{profile.username}</a>
              </div>
            </div>
            {activity ? (
              <>
                <div className={styles.grid} aria-label="GitHub contribution activity for the last 119 days">
                  {activity.map((day) => (
                    <span key={day.date} className={styles.cell} data-level={day.level}
                      title={`${day.count} contributions on ${day.date}`} />
                  ))}
                </div>
                <p className="mt-3 font-mono text-xs">
                  <RollInText text={activity.reduce((total, day) => total + day.count, 0).toLocaleString("en-US")} /> contributions in the last <RollingNumber value={activity.length} /> days
                </p>
              </>
            ) : (
              <p className="text-xs" role="status"><RollInText text={failed ? "Contribution activity unavailable." : "Loading contribution activity…"} /></p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
