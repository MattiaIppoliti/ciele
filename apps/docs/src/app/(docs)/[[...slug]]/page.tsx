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

// Edit-on-GitHub base for doc pages. Env-driven so each deployment (source
// repo, public mirror) points "Edit this page" at its own repo slug; when the
// env is unset the edit link is simply hidden.
const GITHUB_CONTENT_BASE = process.env.NEXT_PUBLIC_DOCS_REPO_URL
  ? `${process.env.NEXT_PUBLIC_DOCS_REPO_URL}/blob/main/apps/docs/content/docs`
  : undefined;

type DocsPageProps = {
  params: Promise<{ slug?: string[] }>;
};

export default async function Page(props: DocsPageProps) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  // The *.md endpoint is at the domain root; the index page maps to /llms.mdx.
  const markdownUrl = page.url === '/' ? '/llms.mdx' : `${page.url}.md`;

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
          GITHUB_CONTENT_BASE
            ? `${GITHUB_CONTENT_BASE}/${page.path}`
            : undefined
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
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
