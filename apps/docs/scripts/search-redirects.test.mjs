import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import config, { RETIRED_PAGES } from '../next.config.mjs';

test('endpoint examples redirect permanently to existing guides', async () => {
  const redirects = await config.redirects();
  const guides = [
    ['/trigger', '/flows/http#on-http-request', '../content/docs/(product)/flows/http.mdx'],
    ['/api/v1', '/developers/api', '../content/docs/developers/api.mdx'],
  ];
  for (const [source, destination, file] of guides) {
    assert.deepEqual(redirects.find((redirect) => redirect.source === source), {
      source, destination, permanent: true,
    });
    const content = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(content, /^---\ntitle:/);
    if (destination.includes('#')) assert.match(content, /^## On HTTP request$/m);
  }
  // A certificate filename is local to the reader's deployment, never a guide
  // or a certificate this site can supply on the reader's behalf.
  assert.equal(redirects.some(({ source }) => source === '/self-hosting/bundle.pem'), false);
});

test('retired pages redirect permanently, in every locale, to a page that exists', async () => {
  const redirects = await config.redirects();
  for (const [source, destination] of RETIRED_PAGES) {
    assert.deepEqual(redirects.find((redirect) => redirect.source === source), {
      source, destination, permanent: true,
    });
    assert.ok(redirects.some((redirect) => redirect.source === `/:lang(it|es|fr|de)${source}`));
    const slug = destination.slice(1);
    const candidates = [`${slug}.mdx`, `${slug}/index.mdx`, `(product)/${slug}.mdx`, `(product)/${slug}/index.mdx`];
    const found = await Promise.any(candidates.map((file) =>
      readFile(new URL(`../content/docs/${file}`, import.meta.url), 'utf8'))).catch(() => undefined);
    assert.ok(found, `${destination} has no page`);
  }
});
