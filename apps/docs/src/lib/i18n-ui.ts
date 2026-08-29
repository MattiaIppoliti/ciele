import { defineI18nUI } from 'fumadocs-ui/i18n';
import { i18n } from './i18n';
import { uiStrings } from './ui-strings';

/**
 * The locale config plus the translated UI chrome, which is what the root layout
 * hands to `RootProvider`. The provider value also supplies the locale list the
 * sidebar's language switcher renders, each labelled by its own `displayName`.
 *
 * Separate from `i18n.ts` on purpose, see the note there about the edge
 * middleware.
 */
const { provider: build } = defineI18nUI(i18n, uiStrings);

/**
 * One frozen value per locale, built at module load.
 *
 * `RootProvider` is a client component that renders next-themes' inline theme
 * `<script>`. Handing it a freshly-built object on every render makes React
 * re-render it on client navigation, and React 19 warns when a `<script>`
 * renders on the client ("Scripts inside React components are never executed
 * when rendering on the client"). A stable reference per locale keeps the
 * provider out of the client re-render path, and saves rebuilding the string
 * bundles per request.
 */
const PROVIDERS = new Map(i18n.languages.map((lang) => [lang as string, build(lang)]));

export function provider(lang: string) {
  return PROVIDERS.get(lang) ?? PROVIDERS.get(i18n.defaultLanguage)!;
}
