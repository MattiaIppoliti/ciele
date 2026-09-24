import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { DOCS_ORIGIN, isCanonicalDocsHost } from '@/lib/seo';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');

  if (!isCanonicalDocsHost(host)) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
    sitemap: new URL('/sitemap.xml', DOCS_ORIGIN).toString(),
  };
}
