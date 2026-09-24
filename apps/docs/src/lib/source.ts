import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { createElement } from 'react';
import { icons } from 'lucide-react';
import { createOpenAPI } from 'fumadocs-openapi/server';
import { i18n } from './i18n';
import { loadOpenApiDocument } from './openapi';
import { apiOperationSlug } from './api-operation-slug';

const openapi = createOpenAPI({
  input: { ciele: async () => loadOpenApiDocument() },
});

const apiOverviewSource = await openapi.staticSource({
  baseDir: 'api-reference',
  per: 'tag',
  name: (page) => `${page.tag?.name ?? 'discovery'}/index`,
  meta: false,
});

const apiOperationSource = await openapi.staticSource({
  baseDir: 'api-reference',
  per: 'operation',
  groupBy: 'tag',
  name: (operation) => operation.type === 'operation'
    ? apiOperationSlug(operation.item.method, operation.item.path)
    : operation.item.name,
  meta: true,
});

type ApiStaticSource = Awaited<ReturnType<typeof openapi.staticSource>>;
const localizedApiSources = new Map<string, Promise<[ApiStaticSource, ApiStaticSource]>>();

function getLocalizedApiSources(language: string) {
  let sourcePromise = localizedApiSources.get(language);
  if (!sourcePromise) {
    sourcePromise = (async () => {
      const localizedOpenapi = createOpenAPI({
        input: { ciele: async () => loadOpenApiDocument(language) },
      });
      return Promise.all([
        localizedOpenapi.staticSource({
          baseDir: 'api-reference',
          per: 'tag',
          name: (page) => `${page.tag?.name ?? 'discovery'}/index`,
          meta: false,
        }),
        localizedOpenapi.staticSource({
          baseDir: 'api-reference',
          per: 'operation',
          groupBy: 'tag',
          name: (operation) => operation.type === 'operation'
            ? apiOperationSlug(operation.item.method, operation.item.path)
            : operation.item.name,
          meta: true,
        }),
      ]);
    })();
    localizedApiSources.set(language, sourcePromise);
  }
  return sourcePromise;
}

/** Resolve generated API pages against the translated contract for the route locale. */
export async function getLocalizedOpenApiPageProps(pagePath: string, language: string) {
  if (language === i18n.defaultLanguage) return undefined;
  const sources = await getLocalizedApiSources(language);
  const page = sources
    .flatMap((item) => item.files)
    .find((file) => file.type === 'page' && file.path === pagePath);
  return page && 'getOpenAPIPageProps' in page.data
    ? page.data.getOpenAPIPageProps()
    : undefined;
}

// Localize the API-domain labels in the sidebar while leaving operation slugs
// stable so existing URLs and generated links continue to work.
for (const language of i18n.languages.filter((item) => item !== i18n.defaultLanguage)) {
  const [, localizedOperations] = await getLocalizedApiSources(language);
  for (const file of localizedOperations.files) {
    if (file.type !== 'meta' || file.path === 'api-reference/meta.json') continue;
    apiOperationSource.files.push({
      ...file,
      path: file.path.replace(/meta\.json$/, `meta.${language}.json`),
    });
  }
}

// Keep the hand-authored edition menu at the root and add each domain's
// overview before its generated operation links.
apiOperationSource.files = apiOperationSource.files
  .filter((file) => file.path !== 'api-reference/meta.json')
  .map((file) => file.type === 'meta'
    ? { ...file, data: { ...file.data, pages: ['index', ...(file.data.pages ?? [])] } }
    : file);

export const source = loader({
  baseUrl: '/',
  i18n,
  source: {
    docs: docs.toFumadocsSource(),
    apiOverview: apiOverviewSource,
    apiOperations: apiOperationSource,
  },
  plugins: [openapi.loaderPlugin()],
  // Resolve the `icon` string in meta.json (e.g. the edition dropdown tabs)
  // to a lucide-react icon component.
  icon(icon) {
    if (!icon) return;
    if (icon in icons) return createElement(icons[icon as keyof typeof icons]);
  },
});
