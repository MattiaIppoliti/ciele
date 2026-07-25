import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { Architects_Daughter, Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

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

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.className} ${sketch.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
