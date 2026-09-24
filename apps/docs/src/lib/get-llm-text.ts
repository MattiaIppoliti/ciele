import { source } from '@/lib/source';

/**
 * Render a single docs page as static Markdown for AI/LLM consumption.
 * Used by the llms-full.txt and *.md endpoints.
 */
export async function getLLMText(page: (typeof source)['$inferPage']) {
  if ('getOpenAPIPageProps' in page.data) {
    const operations = page.data.getOpenAPIPageProps().operations ?? [];
    return `# ${page.data.title} (${page.url})\n\n${operations
      .map(({ method, path }) => `- ${method.toUpperCase()} ${path}`)
      .join('\n')}\n\nFull contract: /api/openapi.json\n`;
  }
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
