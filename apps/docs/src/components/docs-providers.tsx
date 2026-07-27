'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { I18nProviderProps } from 'fumadocs-ui/contexts/i18n';
import { i18n } from '@/lib/i18n';

/**
 * Wraps fumadocs' RootProvider to own what happens when the reader picks a
 * language.
 *
 * Two reasons not to leave it to the default:
 *
 * 1. **The canonical URL.** English has no prefix (`hideLocale:
 *    'default-locale'`), and the built-in handler swaps the first segment
 *    regardless — switching back to English lands on `/en/assistants`, which
 *    only works because middleware then redirects it. This goes straight to
 *    `/assistants`.
 * 2. **A locale switch is a document load, not a client transition.** The
 *    localized root layout carries next-themes' inline `<script>`; re-rendering
 *    it on the client makes React 19 warn on every switch that a script rendered
 *    client-side (harmless — it already ran during SSR — but it fills the
 *    console). A full navigation also guarantees `<html lang>` and the RSC tree
 *    agree, with no half-swapped client state.
 */
export function DocsProviders({
  i18n: options,
  children,
}: {
  i18n: I18nProviderProps;
  children: ReactNode;
}) {
  const pathname = usePathname();

  function onLocaleChange(next: string) {
    const segments = pathname.split('/').filter(Boolean);
    // Drop the locale prefix if the current path carries one.
    if (i18n.languages.includes(segments[0] as never)) segments.shift();
    // Re-add it for every locale but the default, which lives on bare paths.
    if (next !== i18n.defaultLanguage) segments.unshift(next);
    window.location.assign(`/${segments.join('/')}`);
  }

  return (
    <RootProvider i18n={{ ...options, onLocaleChange }}>{children}</RootProvider>
  );
}
