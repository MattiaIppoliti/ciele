import {
  SETUP_SECTIONS,
  navItemForPath,
  assistantIdFromPath,
  assistantSectionFromPath,
  setupHref,
} from "@/components/shell/nav";
import { KNOWLEDGE_TAB_LABELS, isKnowledgeTabSlug } from "@/lib/knowledge-hub";

export interface Crumb {
  /** Stable across renders of the same place, so the bar animates a change. */
  key: string;
  label: string;
  /** Absent on the current page. */
  href?: string;
}

/** The section a route belongs to: its label, and where that section starts. */
function section(pathname: string): { label: string; href: string | null } {
  const scopedId = assistantIdFromPath(pathname);
  if (scopedId) {
    const slug = assistantSectionFromPath(pathname);
    const found = SETUP_SECTIONS.find((candidate) => candidate.slug === slug);
    return found
      ? { label: found.label, href: setupHref(scopedId, found.slug) }
      : { label: "Overview", href: `/assistants/${scopedId}` };
  }
  if (pathname.startsWith("/setup/")) {
    const slug = pathname.slice("/setup/".length);
    const found = SETUP_SECTIONS.find((candidate) => candidate.slug === slug);
    return { label: found?.label ?? "Setup", href: `/setup/${slug}` };
  }
  const nav = navItemForPath(pathname);
  return { label: nav?.label ?? "Overview", href: nav?.href ?? null };
}

type Step = { label: string; href?: string };

/** An opaque record id: it carries a digit, or is too long to be a word. */
function isIdLike(segment: string): boolean {
  return /\d/.test(segment) || segment.length >= 16;
}

function humanize(segment: string): string {
  const text = decodeURIComponent(segment).replace(/[-_]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A step for every segment the explicit rules below do not know, so a route
 * added tomorrow, however deep, still shows where you are. A word becomes its
 * own title and an id becomes "Details", which a page can rename with
 * `PageCrumb`. Every step but the last links to its own prefix.
 */
function generic(parts: string[], from: number): Step[] {
  return parts.slice(from).map((segment, index, rest) => ({
    label: isIdLike(segment) ? "Details" : humanize(segment),
    href:
      index < rest.length - 1
        ? `/${parts.slice(0, from + index + 1).join("/")}`
        : undefined,
  }));
}

/** The places below a section, as far as the URL alone can name them. */
function below(pathname: string): Step[] {
  const parts = pathname.split("/").filter(Boolean);
  const [root, second, third, fourth] = parts;
  const at = (n: number) => `/${parts.slice(0, n).join("/")}`;

  switch (root) {
    case "help-desks":
      return second ? [{ label: "Desk" }] : [];
    case "improvements":
      return second ? [{ label: "Improvement" }] : [];
    case "eval":
      return second ? [{ label: "Run" }] : [];
    case "reviews":
      return second ? [{ label: "Review" }] : [];
    case "inbox":
      if (second !== "channels") return generic(parts, 1);
      return third
        ? [{ label: "Groups", href: at(2) }, { label: "Group" }]
        : [{ label: "Groups" }];
    case "teammates":
      if (second === "channels") return third ? [{ label: "Group" }] : [];
      if (!second) return [];
      return third === "settings"
        ? [{ label: "Teammate", href: at(2) }, { label: "Settings" }]
        : [{ label: "Teammate" }, ...generic(parts, 2)];
    case "library": {
      if (second === "imports") return [{ label: "Import" }];
      if (!second) return [];
      if (!isKnowledgeTabSlug(second)) return generic(parts, 1);
      const tab = { label: KNOWLEDGE_TAB_LABELS[second], href: at(2) };
      if (!third) return [tab];
      return fourth
        ? [tab, { label: "Source", href: at(3) }, { label: "Document" }]
        : [tab, { label: "Source" }];
    }
    case "assistants": {
      const slug = parts[2];
      const rest = parts.slice(3);
      if (slug === "flows" && rest[0]) {
        return [{ label: rest[0] === "new" ? "New flow" : "Flow" }];
      }
      if (slug === "tools" && rest[0] === "skills" && rest[1]) {
        return [{ label: rest[1] === "new" ? "New skill" : "Skill" }];
      }
      if (slug === "knowledge" && rest[0]) {
        if (rest[0] === "imports") return [{ label: "Import" }];
        return rest[1]
          ? [
              { label: "Source", href: `/${parts.slice(0, 4).join("/")}` },
              { label: "Document" },
            ]
          : [{ label: "Source" }];
      }
      return generic(parts, 3);
    }
    case "settings":
    case "setup":
      // Settings is a dialog over tab routes and the setup picker has one
      // level; neither nests.
      return [];
    default:
      return generic(parts, 1);
  }
}

/**
 * The trail after the scope switcher: the section, then whatever the URL says
 * is open inside it. `detailLabel` is a page's own name for its last step (a
 * help desk's name, say), which the URL cannot know.
 */
export function breadcrumbTrail(
  pathname: string,
  detailLabel?: string | null
): Crumb[] {
  const base = section(pathname);
  const steps = below(pathname);
  if (detailLabel && steps.length) steps[steps.length - 1]!.label = detailLabel;
  const crumbs: Crumb[] = [
    { key: `section:${base.label}`, label: base.label, href: base.href ?? undefined },
    ...steps.map((step, index) => ({
      key: `step:${index}:${step.label}`,
      label: step.label,
      href: step.href,
    })),
  ];
  // Only the last crumb is the page you are on.
  return crumbs.map((crumb, index) =>
    index === crumbs.length - 1 ? { ...crumb, href: undefined } : crumb
  );
}
