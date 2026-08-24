"use client";

/**
 * The animated-icon system is its own package, `ciele-animated-icons` on npm:
 * 77 motion-drawn glyphs, the `createAnimatedIcon` factory and the
 * lucide→animated registry. It left this tree because none of it is product
 * logic, and 4.6k lines of SVG made every search through `components/ui`
 * noisier.
 *
 * This module stays as the app's import path so the ~100 call sites keep
 * reading `@/components/ui/animated-icon`.
 */
export {
  AnimatedIcon,
  AnimateIcons,
  StaticIcons,
  type AnimatedIconHandle,
} from "ciele-animated-icons";
