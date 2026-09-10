import { Cloud, Cloudy, HardDrive, Hash, Mail, Workflow } from "lucide-react";
import type { ApplicationProvider } from "@agent-hub/core";
import { cn } from "@/lib/utils";

/**
 * How a connected Application is drawn, in one place.
 *
 * Both surfaces that name a provider read this: the Library's Applications
 * panel, where somebody connects one, and the marketing Knowledge shot, where
 * a visitor sees which ones exist. They used to disagree, and the console's own
 * icons were picked by shape rather than by subject, Google Drive was a
 * `Building2`.
 *
 * **On official logos.** Each brand's own mark would be better than a tile, and
 * an integration directory naming the product it integrates with is ordinary
 * nominative use. What stopped it here is sourcing, not permission: none of
 * these five is in `simple-icons` any more (16.28 carries no Salesforce,
 * ServiceNow, Slack, OneDrive or Google Drive), and drawing a brand mark from
 * memory produces a wrong logo, which is worse than an honest tile. This repo
 * is also mirrored publicly, so committing vendored brand assets is a call for
 * whoever owns the trademark relationship, not a detail to slip into a UI
 * change.
 *
 * So each provider gets its real brand colour and the closest honest symbol,
 * and this file is the single seam: dropping the official SVGs in later means
 * replacing `mark` here and nothing else.
 */
export interface AppBrand {
  label: string;
  /** The brand's own colour, used as the tile ground. */
  color: string;
  /** Foreground on that ground. Slack's aubergine and Drive's green need white. */
  onColor: string;
  mark: typeof Cloud;
}

export const APP_BRANDS: Record<ApplicationProvider, AppBrand> = {
  salesforce: {
    label: "Salesforce",
    color: "#00A1E0",
    onColor: "#FFFFFF",
    // Salesforce's mark is a cloud, so this is the shape rather than a stand-in.
    mark: Cloudy,
  },
  servicenow: {
    label: "ServiceNow",
    color: "#62D84E",
    onColor: "#0B1F12",
    // A workflow engine, which is what the product is and what it imports from.
    mark: Workflow,
  },
  slack: {
    label: "Slack",
    color: "#4A154B",
    onColor: "#FFFFFF",
    // The octothorpe: Slack's own mark is built from it, and a channel is what
    // you actually pick when you import.
    mark: Hash,
  },
  onedrive: {
    label: "OneDrive",
    color: "#0078D4",
    onColor: "#FFFFFF",
    mark: Cloud,
  },
  google_drive: {
    label: "Google Drive",
    color: "#1FA463",
    onColor: "#FFFFFF",
    mark: HardDrive,
  },
  // Not a knowledge source (#841): the Human review sender. Branded so the
  // Applications list and the Flow Builder draw it the same way, but kept out
  // of APP_BRAND_ORDER, which is the import catalogue.
  microsoft_mail: {
    label: "Microsoft 365 mail",
    color: "#0078D4",
    onColor: "#FFFFFF",
    mark: Mail,
  },
};

/** Every provider, in the order both surfaces list them. */
export const APP_BRAND_ORDER: ApplicationProvider[] = [
  "salesforce",
  "servicenow",
  "slack",
  "onedrive",
  "google_drive",
];

/**
 * One provider's tile. `size` is a Tailwind size class, so the same component
 * serves a 40px row in the console and a 24px chip in the marketing shot.
 */
export function AppBrandMark({
  provider,
  size = "size-10",
  className,
}: {
  provider: ApplicationProvider;
  size?: string;
  className?: string;
}) {
  const brand = APP_BRANDS[provider];
  const Mark = brand.mark;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        size,
        className
      )}
      style={{ backgroundColor: brand.color, color: brand.onColor }}
      // The label is always beside it; the tile is identity, not information.
      aria-hidden
    >
      <Mark className="size-[55%]" />
    </span>
  );
}
