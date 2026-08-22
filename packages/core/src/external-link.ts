/**
 * Normalises an admin-typed outbound link to a scheme a link button may carry.
 *
 * Two callers, one rule. The Flow Builder and the quick-reply editor both store
 * a bare host (their `https://` prefix is a fixed UI addon), so a stored value
 * has to be given a scheme somewhere. Doing it in one place also settles the
 * safety question: `show_button` reaches an anchor, which React's own href
 * sanitiser would neutralise, but a quick reply reaches
 * `window.open(url, "_blank", "noopener,noreferrer")` in the widget, which has
 * no sanitiser in front of it. Rather than rely on a browser declining to run a
 * `javascript:` URL in an opaque-origin popup, the scheme is decided here.
 *
 * `mailto:` and `tel:` pass through: a "Call us" or "Email us" button is a real
 * use of a link action, and neither can execute script. Everything else that is
 * not already http(s) is treated as a host, so `javascript:alert(1)` becomes an
 * inert `https://alert(1)` rather than an executable URL.
 */
const SAFE_LINK_SCHEMES = /^(?:https?|mailto|tel):/i;

export function externalLinkUrl(raw: string): string {
  const trimmed = raw.trim();
  if (SAFE_LINK_SCHEMES.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, "")}`;
}
