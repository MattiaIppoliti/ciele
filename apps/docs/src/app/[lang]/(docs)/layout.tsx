import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { CieleWidget } from '@/components/ciele-widget';

/**
 * With i18n the page tree is per-locale, so the sidebar comes from the tree of
 * the requested language.
 */
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  return (
    <DocsLayout tree={source.getPageTree(lang)} {...baseOptions()}>
      {children}
      {/* Reuse the published Ciele assistant's own chat panel (floating
          launcher) instead of a bespoke chat UI. */}
      <CieleWidget />
    </DocsLayout>
  );
}
