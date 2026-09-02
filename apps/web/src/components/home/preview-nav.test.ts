import { describe, expect, it } from "vitest";
import { GLOBAL_NAV, SETUP_SECTIONS } from "@/components/shell/nav";
import {
  PREVIEW_GLOBAL_NAV,
  PREVIEW_SETUP_SECTIONS,
} from "@/components/home/preview-nav";
import { GLOBAL_VIEWS } from "@/components/home/preview-model";

/**
 * The marketing hero's app mock advertises the console, so what it draws has to
 * be what the console has. It no longer *imports* the console's navigation
 * config, that dragged admin routing into the marketing module graph, so this
 * is what keeps the claim true: rename a nav item or add a SETUP section without
 * updating the mock and the build fails here.
 *
 * Labels, slugs and order are pinned. Icons deliberately are not: they are the
 * same lucide glyphs today, but which icon fronts a section is a presentation
 * choice each side may legitimately make differently.
 */
describe("marketing app mock navigation", () => {
  it("draws the console's global nav, in order", () => {
    expect(PREVIEW_GLOBAL_NAV.map((item) => item.label)).toEqual(
      GLOBAL_NAV.map((item) => item.label)
    );
  });

  it("has a pane behind every nav row above the divider", () => {
    // The sidebar casts a clicked label straight to GlobalView, and the pane
    // registry is a Record over that type. A label drawn in the nav but
    // missing from GLOBAL_VIEWS therefore renders `undefined` when clicked
    // (React #130), and the idle showcase skips it. Teammates and Library
    // shipped exactly that way once; this pins the two lists together.
    expect(GLOBAL_VIEWS).toEqual(
      PREVIEW_GLOBAL_NAV.filter((item) => !item.bottom).map((i) => i.label)
    );
  });

  it("keeps the same items below the sidebar divider", () => {
    // The mock renders `bottom` items in their own group after a rule, as the
    // console does; drifting here would draw Alerts and Settings inline.
    expect(PREVIEW_GLOBAL_NAV.filter((item) => item.bottom).map((i) => i.label)).toEqual(
      GLOBAL_NAV.filter((item) => item.bottom).map((i) => i.label)
    );
  });

  it("draws every SETUP section, in order, with the real slugs", () => {
    // Slugs matter as well as labels: the mock keys its faked panes off them,
    // so a renamed slug silently drops a pane rather than failing loudly.
    expect(PREVIEW_SETUP_SECTIONS.map((section) => section.slug)).toEqual(
      SETUP_SECTIONS.map((section) => section.slug)
    );
    expect(PREVIEW_SETUP_SECTIONS.map((section) => section.label)).toEqual(
      SETUP_SECTIONS.map((section) => section.label)
    );
  });

  it("carries no routing, the mock never navigates", () => {
    // If an href ever appears here, the mock has started duplicating the
    // console's routing instead of illustrating it.
    for (const item of [...PREVIEW_GLOBAL_NAV, ...PREVIEW_SETUP_SECTIONS]) {
      expect(item).not.toHaveProperty("href");
    }
  });
});
