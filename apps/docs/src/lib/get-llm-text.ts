import { source } from '@/lib/source';

/**
 * Render a single docs page as static Markdown for AI/LLM consumption.
 * Used by the llms-full.txt and *.md endpoints.
 */
export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
