import { redirect } from 'next/navigation';
import { i18n } from '@/lib/i18n';

export default async function LegacyApiReference({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  redirect(lang === i18n.defaultLanguage ? '/api-reference' : `/${lang}/api-reference`);
}
