import { defineI18n } from 'fumadocs-core/i18n';

/**
 * Locales the documentation is published in.
 *
 * `hideLocale: 'default-locale'` keeps English on the bare paths the site has
 * always used (`/assistants`, `/self-hosting/…`) so no existing link, sitemap
 * entry, or `.md` endpoint moves; the other locales sit under a prefix
 * (`/it/assistants`). English is the source of truth, every other locale's
 * pages are generated from it by `scripts/translate-docs.mjs`.
 *
 * Deliberately free of UI-string imports: the middleware imports this module and
 * runs on the edge, so the translated chrome lives in `i18n-ui.ts` and is pulled
 * in by the layout alone.
 */
export const i18n = defineI18n({
  languages: ['en', 'it', 'es', 'fr', 'de'],
  defaultLanguage: 'en',
  hideLocale: 'default-locale',
});
