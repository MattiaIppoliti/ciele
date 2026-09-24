import { loadOpenApiDocument } from '@/lib/openapi';
import { source } from '@/lib/source';
import { getLLMText } from '@/lib/get-llm-text';

type OpenApiOperation = {
  tags?: string[];
  summary?: string;
  description?: string;
};

type OpenApiDocument = {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string; 'x-displayName'?: string }>;
  components?: unknown;
  security?: unknown;
  paths?: Record<string, Record<string, unknown>>;
};

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

/** Build the complete Markdown corpus linked by Copy Markdown and Open With. */
export async function getApiReferenceMarkdown(language = 'en'): Promise<string> {
  const document = await loadOpenApiDocument(language) as OpenApiDocument;
  const indexPage = source.getPage(['api-reference'], language);
  const intro = indexPage ? await getLLMText(indexPage) : '';
  const tagInfo = new Map((document.tags ?? []).map((tag) => [tag.name, tag]));
  const groups = new Map<string, Array<{ method: string; path: string; operation: OpenApiOperation }>>();

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !rawOperation || typeof rawOperation !== 'object') continue;
      const operation = rawOperation as OpenApiOperation;
      const tag = operation.tags?.[0] ?? 'discovery';
      const operations = groups.get(tag) ?? [];
      operations.push({ method, path, operation });
      groups.set(tag, operations);
    }
  }

  const sections = [...groups.entries()].map(([tag, operations]) => {
    const tagDescription = tagInfo.get(tag)?.description;
    const tagHeading = tagInfo.get(tag)?.['x-displayName'] ?? tag;
    const entries = operations.map(({ method, path, operation }) => {
      const heading = `### ${method.toUpperCase()} ${path}${operation.summary ? ` — ${operation.summary}` : ''}`;
      const description = operation.description ? `\n\n${operation.description}` : '';
      // Preserve the complete OpenAPI operation object: auth, parameters,
      // request bodies, response schemas, headers, and examples.
      const pathMetadata = Object.fromEntries(
        Object.entries(document.paths?.[path] ?? {}).filter(([key]) => !HTTP_METHODS.has(key)),
      );
      const spec = JSON.stringify({ path, ...pathMetadata, [method]: operation }, null, 2);
      return `${heading}${description}\n\n\`\`\`json\n${spec}\n\`\`\``;
    });
    return `## ${tagHeading}${tagDescription ? `\n\n${tagDescription}` : ''}\n\n${entries.join('\n\n')}`;
  });

  const contract = [
    `${document.info?.title ?? 'Ciele API'} · OpenAPI ${document.openapi ?? ''} · ${document.info?.version ?? ''}`.trim(),
    document.info?.description ?? '',
    ...(document.servers ?? []).map((server) => `Server: ${server.url}${server.description ? ` (${server.description})` : ''}`),
    'Download the machine-readable contract: [JSON](/api/openapi.json) · [YAML](/api/openapi.yaml)',
  ].filter(Boolean).join('\n\n');

  const sharedComponents = JSON.stringify({
    security: document.security,
    components: document.components,
  }, null, 2);
  const operationCount = [...groups.values()].reduce((total, operations) => total + operations.length, 0);
  const completionLabels: Record<string, string> = {
    en: `End of the complete API reference · ${operationCount} operations`,
    it: `Fine della documentazione API completa · ${operationCount} operazioni`,
    es: `Fin de la referencia API completa · ${operationCount} operaciones`,
    fr: `Fin de la référence API complète · ${operationCount} opérations`,
    de: `Ende der vollständigen API-Referenz · ${operationCount} Operationen`,
  };
  return [
    intro,
    `# Complete API Reference\n\n${contract}`,
    ...sections,
    `## Shared OpenAPI Components\n\n\`\`\`json\n${sharedComponents}\n\`\`\``,
    `---\n\n${completionLabels[language] ?? completionLabels.en}`,
  ].filter(Boolean).join('\n\n') + '\n';
}
