import { ArrowUpRight } from "lucide-react";
import { GhostMark } from "@/components/auth/ghost-mark";
import { resolveDesktopPackageUrl } from "@/lib/self-host-install";

/**
 * The desktop-app CTA that sits between the hero mock and the feature grid.
 *
 * It used to open a full-screen early-access panel with a waitlist form. The
 * macOS beta is published, so the button now hands over the package itself
 * rather than collecting an address for a link we would have mailed later. One
 * pill, one destination: the latest release, where the build is attached.
 *
 * A plain anchor, not `next/link`: the target is the release page on the source
 * repository, off this app entirely.
 */
export function DownloadCta() {
  return (
    <div className="mb-20 flex justify-center">
      <a
        href={resolveDesktopPackageUrl()}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-3.5 rounded-[18px] bg-zinc-900 p-2.5 pr-6 shadow-sm shadow-zinc-950/10 outline-none transition-colors duration-300 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700"
      >
        <span className="flex size-9 items-center justify-center rounded-[8px] bg-white">
          <GhostMark className="size-7" />
        </span>
        <span className="text-lg font-medium text-white">
          Download Ciele Desktop
        </span>
        {/* Up-right, not right: this leaves the site, the same signal the
            download page's external CTAs use. */}
        <ArrowUpRight className="size-5 text-zinc-400 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </a>
    </div>
  );
}
