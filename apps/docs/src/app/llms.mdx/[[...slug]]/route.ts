import { getLLMText } from '@/lib/get-llm-text';
import { source } from '@/lib/source';
import { notFound } from 'next/navigation';

export const revalidate = false;

// Serves any docs page as raw Markdown. Reached by appending `.md` to a page URL
// (e.g. /authentication/microsoft-entra-id.md), rewritten here in next.config.mjs.
// Params are typed inline rather than via the generated RouteContext global, which
// does not exist when CI runs `tsc` without a prior `next build`.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}

/**
 * English only: this endpoint is the canonical text an agent fetches, and every
 * other locale is generated from it. `getPage(slug)` above already resolves
 * against the default language.
 */
export function generateStaticParams() {
  return source
    .generateParams()
    .filter((params) => params.lang === 'en')
    .map(({ slug }) => ({ slug }));
}
