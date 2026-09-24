import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { docsSitemapUrls, isCanonicalDocsHost } from '@/lib/seo';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host');
  if (!isCanonicalDocsHost(host)) return [];
  return docsSitemapUrls();
}
