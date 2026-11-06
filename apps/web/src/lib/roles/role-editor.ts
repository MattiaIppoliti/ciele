import {
  CAPABILITY_BUNDLES,
  CAPABILITY_CATALOG,
  capabilitiesRelyingOn,
  withRequiredCapabilities,
  type CapabilityBundle,
  type CapabilityDefinition,
} from "@agent-hub/core";

/**
 * The role editor's state as pure functions (#1164), because vitest ignores
 * `.tsx`. The rules the page shows:
 *
 * - **Turning a Capability on turns on what it relies on.** Saving a Role
 *   that edits Flows but cannot see them would be a Role that does nothing.
 * - **A Capability another selected one relies on stays on** until those are
 *   turned off; the row names them instead of silently unticking a dependent.
 * - **A bundle box is tri-state**: on, off, or some. Ticking a bundle turns on
 *   every Capability in it that the Role may hold; unticking turns off every
 *   one nothing outside the bundle relies on.
 * - **An Assistant-only Role offers only Assistant-level Capabilities.**
 */

export type BundleState = "on" | "off" | "some";

export interface BundleView {
  bundle: CapabilityBundle;
  capabilities: CapabilityDefinition[];
  selected: number;
  state: BundleState;
}

/** May this Role hold the Capability at all, given where it is available? */
export function capabilityOffered(capability: CapabilityDefinition, levels: { organizationLevel: boolean }): boolean {
  return levels.organizationLevel || capability.levels.includes("assistant");
}

/** The bundles in display order, each with the Capabilities the search matches. */
export function bundleViews(
  selected: ReadonlySet<string>,
  options: { query?: string; organizationLevel: boolean }
): BundleView[] {
  const query = (options.query ?? "").trim().toLowerCase();
  const matches = (capability: CapabilityDefinition) =>
    !query ||
    capability.id.toLowerCase().includes(query) ||
    capability.label.toLowerCase().includes(query) ||
    capability.description.toLowerCase().includes(query) ||
    capability.bundle.toLowerCase().includes(query);
  return CAPABILITY_BUNDLES.map((bundle) => {
    const all = CAPABILITY_CATALOG.filter((capability) => capability.bundle === bundle);
    const capabilities = all.filter(matches);
    const offered = all.filter((capability) => capabilityOffered(capability, options));
    const chosen = offered.filter((capability) => selected.has(capability.id)).length;
    const state: BundleState = chosen === 0 ? "off" : chosen === offered.length ? "on" : "some";
    return { bundle, capabilities, selected: chosen, state };
  }).filter((view) => view.capabilities.length > 0);
}

/** Labels of the selected Capabilities that keep `id` on, or [] when it may go off. */
export function heldOnBy(id: string, selected: ReadonlySet<string>): string[] {
  return capabilitiesRelyingOn(id, selected).map(
    (dependent) => CAPABILITY_CATALOG.find((capability) => capability.id === dependent)?.label ?? dependent
  );
}

/**
 * The selection after clicking one Capability. Turning on brings its
 * requirements; turning off is refused (the set comes back unchanged) while
 * something selected relies on it.
 */
export function toggleCapability(selected: ReadonlySet<string>, id: string): Set<string> {
  if (!selected.has(id)) return new Set(withRequiredCapabilities([...selected, id]));
  if (capabilitiesRelyingOn(id, selected).length) return new Set(selected);
  const next = new Set(selected);
  next.delete(id);
  return next;
}

/** The selection after clicking a bundle's box. */
export function toggleBundle(
  selected: ReadonlySet<string>,
  bundle: CapabilityBundle,
  levels: { organizationLevel: boolean }
): Set<string> {
  const members = CAPABILITY_CATALOG.filter(
    (capability) => capability.bundle === bundle && capabilityOffered(capability, levels)
  ).map((capability) => capability.id);
  const allOn = members.every((id) => selected.has(id));
  if (!allOn) return new Set(withRequiredCapabilities([...selected, ...members]));
  // Off, except what something outside the bundle still relies on.
  let next = new Set(selected);
  for (const id of members) next.delete(id);
  for (;;) {
    const restore = members.filter((id) => !next.has(id) && capabilitiesRelyingOn(id, next).length);
    if (!restore.length) return next;
    next = new Set([...next, ...restore]);
  }
}

/** Drops what an Assistant-only Role cannot hold, when availability changes. */
export function restrictToLevels(selected: ReadonlySet<string>, levels: { organizationLevel: boolean }): Set<string> {
  if (levels.organizationLevel) return new Set(selected);
  const offered = CAPABILITY_CATALOG.filter((capability) => capabilityOffered(capability, levels)).map((capability) => capability.id);
  const kept = offered.filter((id) => selected.has(id));
  // Keep only what is still closed over its requirements.
  return new Set(withRequiredCapabilities(kept).filter((id) => offered.includes(id)));
}
