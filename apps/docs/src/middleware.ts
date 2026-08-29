import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware';
import { i18n } from '@/lib/i18n';

/**
 * Locale routing: sends a request with no locale prefix to the reader's
 * preferred language, and keeps English on the bare paths (`hideLocale:
 * 'default-locale'`).
 */
export default createI18nMiddleware(i18n);

export const config = {
  /*
   * Everything except Next's own assets and the machine-readable endpoints.
   * Those must never be locale-prefixed: `/llms.txt` and `/llms-full.txt` are
   * fetched by agents at fixed URLs, and `*.md` is rewritten to the Markdown
   * route by next.config.mjs, a rewrite that middleware would otherwise see
   * first and prefix.
   */
  matcher: [
    '/((?!api|_next/static|_next/image|icon.svg|favicon.ico|llms.txt|llms-full.txt|llms.mdx|.*\\.md$).*)',
  ],
};
