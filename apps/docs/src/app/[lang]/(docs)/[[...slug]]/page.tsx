import { getLocalizedOpenApiPageProps, source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import { PageActions } from '@/components/page-actions';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { DOCS_REPO_URL } from '@/lib/repo';
import { docsAlternates, docsOpenGraph } from '@/lib/seo';
import { i18n } from '@/lib/i18n';
import { OpenAPIPage } from '@/components/openapi-page';
import { apiOperationSlug } from '@/lib/api-operation-slug';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

// Edit-on-GitHub base for doc pages, present only when this deployment declares
// a repository, see `lib/repo.ts`. Undefined drops the "Open on GitHub" item
// from the page-actions menu rather than linking to a guessed slug.
const GITHUB_CONTENT_BASE = DOCS_REPO_URL
  ? `${DOCS_REPO_URL}/blob/main/apps/docs/content/docs`
  : undefined;

type DocsPageProps = {
  params: Promise<{ lang: string; slug?: string[] }>;
};

export default async function Page(props: DocsPageProps) {
  const params = await props.params;
  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  if ('getOpenAPIPageProps' in page.data) {
    const apiProps = await getLocalizedOpenApiPageProps(page.path, params.lang)
      ?? page.data.getOpenAPIPageProps();
    if (page.path.endsWith('/index.mdx')) {
      const document = apiProps.payload.bundled as {
        paths?: Record<string, Record<string, { summary?: string }>>;
      };
      return (
        <DocsPage toc={[]} full>
          <DocsTitle>{page.data.title}</DocsTitle>
          <DocsDescription>{page.data.description}</DocsDescription>
          <DocsBody>
            <div className="ciele-api-operation-list not-prose grid gap-4">
              {(apiProps.operations ?? []).map((operation) => (
                <Link
                  key={`${operation.method} ${operation.path}`}
                  href={`${page.url}/${apiOperationSlug(operation.method, operation.path)}`}
                  className="ciele-api-operation-link flex items-center gap-4 rounded-xl border border-fd-border px-6 py-5 hover:bg-fd-accent"
                >
                  <span className="w-14 shrink-0 font-mono text-xs font-semibold uppercase text-fd-primary">
                    {operation.method}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {document.paths?.[operation.path]?.[operation.method]?.summary ?? operation.path}
                    </span>
                    <span className="block truncate font-mono text-xs text-fd-muted-foreground">
                      {operation.path}
                    </span>
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="ciele-api-operation-arrow ms-2 size-4 shrink-0 text-fd-muted-foreground"
                    strokeWidth={1.75}
                  />
                </Link>
              ))}
            </div>
          </DocsBody>
        </DocsPage>
      );
    }
    return (
      <DocsPage toc={page.data.toc} full tableOfContent={{ style: 'clerk' }}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsBody>
          <OpenAPIPage {...apiProps} />
        </DocsBody>
      </DocsPage>
    );
  }

  const MDX = page.data.body;
  // The Markdown endpoints serve the English source only, they exist for agents
  // fetching canonical text, and a translated page is a generated artifact of
  // that source. `page.path` carries the locale suffix, so strip it.
  const englishUrl = page.url.replace(new RegExp(`^/${params.lang}(?=/|$)`), '') || '/';
  const markdownUrl = englishUrl === '/'
    ? '/llms.mdx'
    : englishUrl === '/api-reference'
      ? `/api-reference/all.md${params.lang === 'en' ? '' : `?lang=${encodeURIComponent(params.lang)}`}`
      : `${englishUrl}.md`;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={{ style: 'clerk' }}
      tableOfContentPopover={{ style: 'clerk' }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <PageActions
        markdownUrl={markdownUrl}
        contentLabel={englishUrl === '/api-reference' ? 'the complete Ciele API reference' : undefined}
        githubUrl={
          GITHUB_CONTENT_BASE && `${GITHUB_CONTENT_BASE}/${page.path}`
        }
      />
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: DocsPageProps,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  const localePrefix = params.lang === i18n.defaultLanguage ? '' : `/${params.lang}`;
  const fallbackUrl = `${localePrefix}/${params.slug?.join('/') ?? ''}`.replace(/\/$/, '') || '/';
  const pageUrl = page.url ?? fallbackUrl;
  const title = page.data.title ?? 'Ciele documentation';
  const description = page.data.description ?? 'Ciele product and developer documentation.';

  return {
    title,
    description,
    alternates: docsAlternates(pageUrl, params.lang),
    openGraph: docsOpenGraph(pageUrl, title, description),
    twitter: {
      card: 'summary_large_image',
      title: `${title} | Ciele Docs`,
      description,
      images: ['https://ciele.app/opengraph-image'],
    },
  };
}
