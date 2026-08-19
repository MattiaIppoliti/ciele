import { source } from '@/lib/source';
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

  const MDX = page.data.body;
  // The Markdown endpoints serve the English source only, they exist for agents
  // fetching canonical text, and a translated page is a generated artifact of
  // that source. `page.path` carries the locale suffix, so strip it.
  const englishUrl = page.url.replace(new RegExp(`^/${params.lang}(?=/|$)`), '') || '/';
  const markdownUrl = englishUrl === '/' ? '/llms.mdx' : `${englishUrl}.md`;

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

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
