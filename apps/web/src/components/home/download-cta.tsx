import { ArrowUpRight } from "lucide-react";
import { Button } from "@agent-hub/ui";
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
      <Button size="lg" icon={<GhostMark className="size-5" />} iconRight={<ArrowUpRight />}
        render={<a href={resolveDesktopPackageUrl()} target="_blank" rel="noreferrer" />}>
        Download Ciele Desktop
      </Button>
    </div>
  );
}
