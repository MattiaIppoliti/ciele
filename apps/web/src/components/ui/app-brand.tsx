import type { ApplicationProvider } from "@agent-hub/core";
import { APP_BRAND_PATHS } from "./app-brand-paths";
import { cn } from "@/lib/utils";

/** Official application marks, shared by Knowledge and marketing. */
export interface AppBrand {
  label: string;
  /** The brand's own colour, used as the tile ground. */
  color: string;
  /** Foreground on that ground. Slack's aubergine and Drive's green need white. */
  onColor: string;
}

export const APP_BRANDS: Record<ApplicationProvider, AppBrand> = {
  salesforce: {
    label: "Salesforce",
    color: "#00A1E0",
    onColor: "#FFFFFF",
  },
  servicenow: {
    label: "ServiceNow",
    color: "#62D84E",
    onColor: "#0B1F12",
  },
  slack: {
    label: "Slack",
    color: "#4A154B",
    onColor: "#FFFFFF",
  },
  onedrive: {
    label: "OneDrive",
    color: "#0078D4",
    onColor: "#FFFFFF",
  },
  google_drive: {
    label: "Google Drive",
    color: "#1FA463",
    onColor: "#FFFFFF",
  },
  // Not a knowledge source (#841): the Human review sender. Branded so the
  // Applications list and the Flow Builder draw it the same way, but kept out
  // of APP_BRAND_ORDER, which is the import catalogue.
  microsoft_mail: {
    label: "Microsoft 365 mail",
    color: "#0078D4",
    onColor: "#FFFFFF",
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
      {provider === "servicenow" ? <svg viewBox="95 5 16 15" className="size-[65%]"><path d="m102.8 5.762c-4.2 0-7.5 3.3-7.5 7.5 0 2.2 0.9 4.2 2.3 5.6 0.5 0.5 1.4 0.5 2 0.1 0.8-0.7 2-1.1 3.2-1.1 1.3 0 2.3 0.4 3.2 1.1 0.6 0.5 1.4 0.4 2-0.2 1.4-1.4 2.3-3.3 2.3-5.5-0.1-4.1-3.4-7.5-7.5-7.5m-0.1 11.4c-2.3 0-3.8-1.7-3.8-3.8s1.5-3.8 3.8-3.8 3.8 1.7 3.8 3.8-1.5 3.8-3.8 3.8" fill="currentColor" fillRule="evenodd" /></svg> : (
        <svg viewBox="0 0 24 24" className="size-[65%]"><path d={APP_BRAND_PATHS[provider]} fill="currentColor" /></svg>
      )}
    </span>
  );
}
