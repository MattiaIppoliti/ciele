import { createMDX } from 'fumadocs-mdx/next';

// Pages removed from the manual that Google still holds, mapped to the page that
// now covers the topic. Each also redirects under every locale prefix.
export const RETIRED_PAGES = [
  ['/cloud/support', '/cloud'],
  ['/cloud/team-and-sso', '/organization/members-and-roles'],
  ['/help-desks/ticketing-and-improvements', '/help-desks/improvements'],
  ['/self-hosting/upgrading', '/self-hosting/upgrade'],
  ['/data/entities-and-records', '/data'],
];

/** @type {import('next').NextConfig} */
const config = {
  // Shared workspace UI is raw TypeScript (no build step), transpile it here.
  transpilePackages: ['@agent-hub/ui'],
  async headers() {
    return [{
      source: '/_next/static/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
    }];
  },
  // Paths discovered from endpoint examples should lead to the corresponding
  // guide. Local certificate filenames have no public replacement and stay 404.
  async redirects() {
    return [
      { source: '/trigger', destination: '/flows/http#on-http-request', permanent: true },
      { source: '/api/v1', destination: '/developers/api', permanent: true },
      ...RETIRED_PAGES.flatMap(([source, destination]) => [
        { source, destination, permanent: true },
        { source: `/:lang(it|es|fr|de)${source}`, destination: `/:lang${destination}`, permanent: true },
      ]),
    ];
  },
  // Let AI agents fetch any page as raw Markdown by appending `.md` to its URL.
  // Docs are served at the domain root, so map `/<path>.md` to the Markdown route.
  async rewrites() {
    return [
      {
        source: '/:path*.md',
        destination: '/llms.mdx/:path*',
      },
    ];
  },
};

const withMDX = createMDX();

export default withMDX(config);
