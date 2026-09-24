import { SITE_URL } from '@/lib/repo';
import generatedDocument from './openapi.generated.json';
import generatedDocumentIt from './openapi.generated.it.json';
import generatedDocumentEs from './openapi.generated.es.json';
import generatedDocumentFr from './openapi.generated.fr.json';
import generatedDocumentDe from './openapi.generated.de.json';

/** The public contract is generated from the web app's route registry. */
export async function loadOpenApiDocument(language = 'en'): Promise<Record<string, unknown>> {
  const origin = new URL(process.env.CIELE_API_ORIGIN || SITE_URL).origin;
  const documents: Record<string, Record<string, unknown>> = {
    en: generatedDocument,
    it: generatedDocumentIt,
    es: generatedDocumentEs,
    fr: generatedDocumentFr,
    de: generatedDocumentDe,
  };
  return { ...(documents[language] ?? generatedDocument), servers: [{ url: origin }] };
}
