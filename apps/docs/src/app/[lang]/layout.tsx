// Alias rather than a relative path: this layout lives inside the `[lang]`
// segment while the stylesheet stays at the app root, and a relative import
// silently depends on that depth.
import '@/app/global.css';
import { DocsProviders } from '@/components/docs-providers';
import { ProgressiveBlur } from '@agent-hub/ui';
import { Architects_Daughter, Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { i18n } from '@/lib/i18n';
import { provider } from '@/lib/i18n-ui';

const inter = Inter({ subsets: ['latin'] });

/**
 * Handwriting face for the hand-drawn architecture diagrams (see
 * `components/mermaid.tsx`). Exposed as a variable rather than applied to the
 * body: only diagram text uses it. Self-hosted by `next/font`, so no external
 * request.
 */
const sketch = Architects_Daughter({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-sketch',
});

export const metadata: Metadata = {
  title: {
    default: 'Ciele Docs',
    template: '%s | Ciele Docs',
  },
  description: 'Documentation for Ciele.',
};

/**
 * The root layout lives under `[lang]` because every page is localized and the
 * locale has to be known before `<html lang>` is written. The non-localized
 * endpoints (`/llms.txt`, `/api/search`, the `.md` route) are route handlers and
 * need no layout, so they stay outside this segment.
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
    <html
      lang={lang}
      className={`${inter.className} ${sketch.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <DocsProviders i18n={provider(lang)}>{children}</DocsProviders>
        {/* Same viewport-bottom progressive blur as the marketing pages, but
            shorter and gentler: this is a reading surface, so the band only
            softens the last line or two as it exits the screen. Fumadocs owns
            the theme tokens here, hence the fd background instead of ours. */}
        <ProgressiveBlur
          className="h-20"
          maxBlur={8}
          tint="var(--color-fd-background)"
        />
      </body>
    </html>
  );
}

/** One shell per locale. */
export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}
