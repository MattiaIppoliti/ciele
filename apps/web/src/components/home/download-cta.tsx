import { ArrowRight } from "lucide-react";
import { GhostMark } from "@/components/auth/ghost-mark";
import { resolveSourceUrl } from "@/lib/self-host-install";

/**
 * The home page's download call-to-action: a direct link to the macOS
 * desktop app, whose build is attached to every release of the public
 * repository (same target as the download page's "Download for macOS").
 */
const MAC_DOWNLOAD_URL = `${resolveSourceUrl()}/releases/latest`;

export function DownloadCta() {
  return (
    <div className="mb-20 flex flex-col items-center gap-3">
      <a
        href={MAC_DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-3.5 rounded-[18px] bg-zinc-900 p-2.5 pr-6 shadow-sm shadow-zinc-950/10 transition-colors duration-300 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700"
      >
        <span className="flex size-9 items-center justify-center rounded-[8px] bg-white">
          <GhostMark className="size-7" />
        </span>
        <span className="text-lg font-medium text-white">
          Download Ciele Desktop
        </span>
        <ArrowRight className="size-5 text-zinc-400 transition-transform duration-300 group-hover:translate-x-0.5" />
      </a>
      <p className="text-muted-foreground text-sm">
        The native desktop app for macOS.
      </p>
    </div>
  );
}
