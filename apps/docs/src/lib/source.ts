import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { createElement } from 'react';
import { icons } from 'lucide-react';

export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource(),
  // Resolve the `icon` string in meta.json (e.g. the edition dropdown tabs)
  // to a lucide-react icon component.
  icon(icon) {
    if (!icon) return;
    if (icon in icons) return createElement(icons[icon as keyof typeof icons]);
  },
});
