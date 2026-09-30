/**
 * Class-string rules that keep product UI on the design system's tokens
 * (DESIGN.md at the repo root). Two patterns, each with the reason it is
 * refused:
 *
 * - `shadow-sm|md|lg|xl|2xl`: the system has two elevations, `shadow-light`
 *   and `shadow-strong`. The raw ramp was five answers to one question, and in
 *   dark mode most of them draw nothing over #121212.
 * - `text-[Npx]`: a pixel size ignores the console's 92% density and skips the
 *   step-bound tracking. `text-2xs` is the rung below `text-xs`.
 *
 * The rules match string literals and template chunks, so a class inside
 * `cn(...)`, a ternary or a class map is caught the same as a `className`.
 *
 * Returned as three config objects because every entry here sets the same
 * rule, `no-restricted-syntax`, and flat config lets the last matching object
 * win: an exempt folder gets an object carrying only the other pattern. A
 * consumer that sets `no-restricted-syntax` itself must merge with these
 * selectors, or it silently drops them.
 *
 * @param {{ files: string[], shadowExempt?: string[], typeExempt?: string[] }} scope
 *   `files`: where the rules apply. `shadowExempt`: art-directed surfaces
 *   (marketing, auth) that keep large tinted shadows on purpose.
 *   `typeExempt`: vendored components kept close to upstream.
 */
export function designTokenRules({ files, shadowExempt = [], typeExempt = [] }) {
  const shadow = restrict(
    /(^|[\s:"'`])shadow-(sm|md|lg|xl|2xl)(?![\w-])/,
    "Use shadow-light (resting lift) or shadow-strong (floating layer). See DESIGN.md §2.7."
  );
  const type = restrict(
    /(^|[\s:"'`])text-\[\d+(\.\d+)?px\]/,
    "Use the type scale: text-2xs below text-xs, never a pixel size. See DESIGN.md §2.5."
  );
  const rule = (selectors) => ({
    "no-restricted-syntax": ["error", ...selectors],
  });

  return [
    { files, ignores: [...shadowExempt, ...typeExempt], rules: rule([...shadow, ...type]) },
    ...(shadowExempt.length ? [{ files: shadowExempt, rules: rule(type) }] : []),
    ...(typeExempt.length ? [{ files: typeExempt, rules: rule(shadow) }] : []),
  ];
}

/** One selector for string literals, one for template-literal chunks. */
function restrict(pattern, message) {
  const regex = pattern.source;
  return [
    { selector: `Literal[value=/${regex}/]`, message },
    { selector: `TemplateElement[value.raw=/${regex}/]`, message },
  ];
}
