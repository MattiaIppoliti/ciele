/**
 * The branded HTML shell for emails a person reads on the public site.
 *
 * Written as one function returning a string rather than a React component:
 * email HTML is tables and inline styles, none of which benefits from JSX, and
 * a string keeps the module inside the `.test.ts`-only vitest include.
 *
 * Three constraints shape every choice here, and they are why this does not
 * look like the site's CSS:
 * - **No images, not even the ghost mark.** Gmail and Outlook block remote
 *   images by default, so a logo-as-image renders as a broken box on first
 *   open. The wordmark is text in a serif stack that lands near Sorts Mill
 *   Goudy on every platform (Georgia is the practical floor).
 * - **No web fonts.** They fail in Outlook and Gmail's app; the site's Goudy
 *   and Host Grotesk are approximated by stacks, not loaded.
 * - **Inline styles only.** The `<style>` block carries the dark-mode override
 *   and nothing load-bearing, because Gmail strips it.
 *
 * Colours are the light-theme tokens from globals.css transcribed to hex,
 * since oklch() is not safe in mail clients.
 */

const PAGE = "#f5f5f5";
const CARD = "#ffffff";
const BORDER = "#e6e6e6";
const INK = "#252525";
const MUTED = "#8a8a8a";
const BUTTON = "#252525";
const BUTTON_INK = "#fafafa";

const SERIF = "'Sorts Mill Goudy', Georgia, 'Times New Roman', serif";
const SANS =
  "'Host Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface BrandedEmail {
  /** The line the inbox shows after the subject. Hidden inside the message. */
  preheader: string;
  heading: string;
  /** Body copy, one entry per paragraph. */
  paragraphs: string[];
  cta?: { label: string; url: string };
  /**
   * The CTA's URL repeated as text. Some clients strip buttons, and a
   * confirmation the reader cannot copy out is a dead end.
   */
  showUrlFallback?: boolean;
  /** Small print under the rule. */
  footnotes?: string[];
}

export function renderBrandedEmail(input: BrandedEmail): string {
  const paragraphs = input.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:24px;color:${INK};">${escapeHtml(text)}</p>`
    )
    .join("");

  const cta = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
        <tr><td class="cta" style="border-radius:999px;background:${BUTTON};">
          <a href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:15px;font-weight:500;line-height:20px;color:${BUTTON_INK};text-decoration:none;border-radius:999px;">${escapeHtml(input.cta.label)}</a>
        </td></tr>
      </table>`
    : "";

  const fallback =
    input.cta && input.showUrlFallback
      ? `<p style="margin:24px 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};">Or paste this into your browser:</p>
         <p style="margin:6px 0 0;font-family:${MONO};font-size:12px;line-height:20px;word-break:break-all;"><a href="${escapeHtml(input.cta.url)}" style="color:${MUTED};">${escapeHtml(input.cta.url)}</a></p>`
      : "";

  const footnotes = input.footnotes?.length
    ? `<hr style="margin:32px 0 20px;border:0;border-top:1px solid ${BORDER};" />
       ${input.footnotes
         .map(
           (note) =>
             `<p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:19px;color:${MUTED};">${escapeHtml(note)}</p>`
         )
         .join("")}`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<style>
  @media (prefers-color-scheme: dark) {
    .page { background:#121212 !important; }
    .card { background:#191919 !important; border-color:rgba(255,255,255,0.12) !important; }
    .ink, .ink p, .ink a.wordmark { color:#fafafa !important; }
    .cta { background:#fafafa !important; }
    .cta a { color:#252525 !important; }
  }
  @media (max-width:600px) {
    .card { padding:28px 22px !important; }
    .display { font-size:24px !important; line-height:31px !important; }
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" style="background:${PAGE};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td class="card ink" style="background:${CARD};border:1px solid ${BORDER};border-radius:20px;padding:36px 34px;">
            <a href="https://ciele.app" class="wordmark" style="font-family:${SERIF};font-size:20px;line-height:24px;color:${INK};text-decoration:none;letter-spacing:0.01em;">Ciele</a>
            <h1 class="display" style="margin:26px 0 14px;font-family:${SERIF};font-size:28px;line-height:35px;font-weight:400;color:${INK};">${escapeHtml(input.heading)}</h1>
            ${paragraphs}
            ${cta}
            ${fallback}
            ${footnotes}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:18px 8px 0;font-family:${SANS};font-size:12px;line-height:19px;color:${MUTED};">
            Ciele · <a href="https://ciele.app" style="color:${MUTED};text-decoration:underline;">ciele.app</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
