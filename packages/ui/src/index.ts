/**
 * @agent-hub/ui, the UI primitives shared byte-for-byte by both apps.
 *
 * Raw workspace TypeScript, no build step (same convention as
 * @agent-hub/charts): consumers list the package in `transpilePackages` and
 * add `@source "../../../../packages/ui/src";` to their globals.css so
 * Tailwind scans these class strings: without that directive the utilities
 * are silently purged, not a build error.
 *
 * Only components identical in both apps live here. App-specific primitives
 * (and the deliberately divergent select / resizable-panel / table /
 * dropdown-menu, web's gained a shell-only sliding-highlight pill) stay in
 * each app's components/ui and can be promoted here once reconciled.
 */
export { cn } from "./cn";
export * from "./badge";
export * from "./button";
export * from "./calendar";
export * from "./card";
export * from "./copy-feedback";
export * from "./dialog";
export * from "./hint";
export * from "./input";
export * from "./label";
export * from "./popover";
export * from "./progressive-blur";
export * from "./separator";
export * from "./skeleton";
export * from "./tooltip";
