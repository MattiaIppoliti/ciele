import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

/**
 * One index per locale. The map tells Orama which stemmer each locale needs,
 * the search box sends the reader's locale, so an Italian query is stemmed as
 * Italian instead of being run through the English analyzer.
 * https://docs.orama.com/docs/orama-js/supported-languages
 */
export const { GET } = createFromSource(source, {
  localeMap: {
    en: 'english',
    it: 'italian',
    es: 'spanish',
    fr: 'french',
    de: 'german',
  },
});
