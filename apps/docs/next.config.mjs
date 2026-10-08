import { createMDX } from 'fumadocs-mdx/next';

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
