import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import config from '../next.config.mjs';

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
