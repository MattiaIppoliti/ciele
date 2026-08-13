import {
  BookText,
  Cloud,
  Fingerprint,
  Gauge,
  LayoutGrid,
  LifeBuoy,
  MousePointerClick,
  Rocket,
  Server,
  Unplug,
  Users,
  Workflow,
} from "lucide-react";
import { FEATURES, type FeatureEntry } from "@/components/marketing/feature-catalog";

/**
 * What the marketing nav contains — the menu tree and the docs tile grid.
 *
 * Data only, and its own module because the header's chrome (the morphing pill,
 * the panel that glides between triggers) and the nav's *contents* change for
 * completely different reasons: one is motion and measurement, the other is
 * which pages we point at. Editing a link should not mean reading a
 * requestAnimationFrame loop.
 */

// Only destinations that resolve from every page the header renders on.
// "Features" was a bare #features anchor: it scrolled on the marketing home and
// did nothing at all on /pricing, /security or the policy pages.
export type MenuLink = { name: string; href: string; external?: boolean };
/** A promo tile in a dropdown: label + title over an abstract visual. */
export type PanelCard = {
  badge: string;
  title: string;
  href: string;
  external?: boolean;
  visual: "list" | "grid" | "waves" | "lock" | "folder" | "flows";
};
export type MenuItem = MenuLink & {
  /* Present = the item is a dropdown trigger, not a link of its own. `href`
     stays the group's own landing page so the mobile list (which has no
     hover) and keyboard users still get somewhere to go. */
  columns?: MenuLink[][];
  /* Right-hand side of the panel: promo cards, or (Docs only) the icon grid. */
  cards?: PanelCard[];
  areaGrid?: boolean;
};

export const DOCS = "https://docs.ciele.app";

/** Every docs link is external and opens in a new tab — spelled once. */
const doc = (name: string, path: string): MenuLink => ({
  name,
  href: `${DOCS}${path}`,
  external: true,
});

/** The Features group is the feature catalogue — one entry, one page. */
const featureLink = (feature: FeatureEntry): MenuLink => ({
  name: feature.label,
  href: `/features/${feature.slug}`,
});

export const menuItems: MenuItem[] = [
  {
    name: "Features",
    href: `/features/${FEATURES[0].slug}`,
    /* Split down the middle of the catalogue: building an assistant on the
       left, running it on the right. */
    columns: [
      FEATURES.slice(0, 5).map(featureLink),
      FEATURES.slice(5).map(featureLink),
    ],
    cards: [
      {
        badge: "Route",
        title: "Flows",
        href: "/features/flows",
        visual: "flows",
      },
      {
        badge: "Measure",
        title: "Insights",
        href: "/features/insights",
        visual: "waves",
      },
    ],
  },
  {
    name: "Enterprise",
    href: "/enterprise",
    columns: [
      [
        { name: "Enterprise governance", href: "/enterprise" },
        { name: "Pricing", href: "/pricing" },
        { name: "Security & compliance", href: "/security" },
        { name: "Talk to sales", href: "/contact/sales" },
      ],
    ],
    cards: [
      {
        badge: "Govern",
        title: "Enterprise governance",
        href: "/enterprise",
        visual: "lock",
      },
    ],
  },
  {
    name: "Resources",
    href: "/security",
    columns: [
      [
        { name: "Security", href: "/security" },
        { name: "Privacy", href: "/policies/privacy" },
        { name: "Terms of Service", href: "/policies/terms-of-service" },
        { name: "Cookies", href: "/policies/cookies" },
        { name: "Talk to sales", href: "/contact/sales" },
      ],
    ],
    cards: [
      {
        badge: "Self-host",
        title: "Run it yourself",
        /* Our own download page, not the docs: the site sells it, the docs
           explain it. The page links onward to the full guide itself. */
        href: "/download",
        visual: "folder",
      },
    ],
  },
  {
    name: "Docs",
    href: DOCS,
    external: true,
    areaGrid: true,
    columns: [
      [
        doc("Getting started", "/getting-started"),
        doc("Core concepts", "/getting-started/core-concepts"),
        doc("Create an assistant", "/getting-started/create-an-assistant"),
        doc("Self-hosting", "/self-hosting"),
      ],
    ],
  },
  /* A plain link, deliberately last: the one item that hands you the product
     rather than a pitch about it. */
  { name: "Download", href: "/download" },
];

/* The Docs panel's right half: one tile per top-level docs area, in the order
   the docs sidebar uses (Start here → Build → Connect → Run → Cloud/self-host).
   Icons, not vendor logos: the docs are product documentation, not an SDK
   reference, so what belongs here is the shape of the manual. These are the
   `@lucide-animated` icons, rendered through `AnimatedIcon` so the animation is
   driven by the tile's own hover — the glyph is 19px inside a 44px target, and
   the icon's built-in listeners would only fire on the glyph itself. */
export const docsAreas = [
  { name: "Getting started", href: "/getting-started", Icon: Rocket },
  { name: "Assistants", href: "/assistants", Icon: MousePointerClick },
  { name: "Knowledge", href: "/knowledge", Icon: BookText },
  { name: "Flows", href: "/flows", Icon: Workflow },
  { name: "Help desks", href: "/help-desks", Icon: LifeBuoy },
  { name: "Authentication", href: "/authentication", Icon: Fingerprint },
  { name: "Publishing", href: "/publishing", Icon: Unplug },
  { name: "Operations", href: "/operations", Icon: Gauge },
  { name: "Organization", href: "/organization", Icon: Users },
  { name: "Cloud", href: "/cloud", Icon: Cloud },
  { name: "Self-hosting", href: "/self-hosting", Icon: Server },
  { name: "Architecture", href: "/self-hosting/architecture", Icon: LayoutGrid },
];
