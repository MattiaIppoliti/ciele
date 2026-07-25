import { defineDocs, defineConfig } from 'fumadocs-mdx/config';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    // Keep a processed-Markdown copy of every page so the AI/LLM endpoints
    // (llms.txt, llms-full.txt, *.md) can serve clean text via getText('processed').
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig();
