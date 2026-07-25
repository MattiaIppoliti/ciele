import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { CieleWidget } from '@/components/ciele-widget';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
      {children}
      {/* Reuse the published Ciele assistant's own chat panel (floating
          launcher) instead of a bespoke chat UI. */}
      <CieleWidget />
    </DocsLayout>
  );
}
