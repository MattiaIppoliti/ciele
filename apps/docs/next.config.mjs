import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Shared workspace UI is raw TypeScript (no build step), transpile it here.
  transpilePackages: ['@agent-hub/ui'],
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
