import { i18n } from '@/lib/i18n';
import { source } from '@/lib/source';

export const DOCS_ORIGIN = new URL('https://docs.ciele.app');

const pagesByLanguage = new Map(
  i18n.languages.map((language) => [language, source.getPages(language)]),
);

function languageNeutralPath(url: string, language: string): string {
  if (language === i18n.defaultLanguage) return url || '/';
  return url.replace(new RegExp(`^/${language}(?=/|$)`), '') || '/';
}

/**
 * A translated API-reference page is the English operation schema with its
 * summaries translated. Readers keep it, but Google treats ~700 of them as
 * near-duplicates and leaves them "Discovered, not indexed", which also slows
 * the crawl of the guides. So they stay out of the sitemap and the hreflang
 * sets, and carry `noindex, follow`.
 */
function isTranslatedApiReference(url: string, language: string): boolean {
  return language !== i18n.defaultLanguage
    && /^\/api-reference(?:\/|$)/.test(languageNeutralPath(url, language));
}

function localizedUrls() {
  const result = new Map<string, Record<string, string>>();

  for (const [language, pages] of pagesByLanguage) {
    for (const page of pages) {
      if (isTranslatedApiReference(page.url, language)) continue;
      const key = languageNeutralPath(page.url, language);
      const urls = result.get(key) ?? {};
      urls[language] = new URL(page.url, DOCS_ORIGIN).toString();
      result.set(key, urls);
    }
  }

  return result;
}

const urlsByPath = localizedUrls();

export function docsAlternates(url: string, language: string) {
  const languages = urlsByPath.get(languageNeutralPath(url, language)) ?? {};
  const english = languages[i18n.defaultLanguage];

  return {
    canonical: new URL(url, DOCS_ORIGIN).toString(),
    languages: {
      ...languages,
      ...(english ? { 'x-default': english } : {}),
    },
  };
}

export function docsRobots(url: string, language: string) {
  return isTranslatedApiReference(url, language) ? { index: false, follow: true } : undefined;
}

export function docsOpenGraph(url: string, title: string, description: string) {
  return {
    type: 'article' as const,
    siteName: 'Ciele Docs',
    title: `${title} | Ciele Docs`,
    description,
    url: new URL(url, DOCS_ORIGIN).toString(),
    images: ['https://ciele.app/opengraph-image'],
  };
}

export function docsSitemapUrls() {
  return Array.from(urlsByPath.values())
    .filter((languages) => languages[i18n.defaultLanguage])
    .flatMap((languages) =>
      Object.values(languages).map((url) => ({
        url,
        alternates: { languages: { ...languages, 'x-default': languages[i18n.defaultLanguage] } },
      })),
    );
}

export function isCanonicalDocsHost(host: string | null): boolean {
  if (!host) return false;
  try {
    return new URL(`https://${host}`).hostname === DOCS_ORIGIN.hostname;
  } catch {
    return false;
  }
}
