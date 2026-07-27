import type { NextConfig } from "next";
import { existsSync } from "node:fs";

const connectorArtifacts = [
  "./public/connectors/ciele-local-connector-0.3.4.mjs",
].filter((path) => existsSync(path));

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (#439): `next build`
  // traces every runtime file into .next/standalone, so the container ships
  // node_modules-free (see apps/web/Dockerfile). No effect on Vercel deploys.
  output: "standalone",
  transpilePackages: [
    "@agent-hub/agent",
    "@agent-hub/core",
    "@agent-hub/db",
    "@agent-hub/ui",
  ],
  outputFileTracingIncludes: {
    // The runtime route reads this file at request time; trace it into the
    // standalone bundle. The terminal one-liner is served from here too.
    "/api/local-connector/runtime": connectorArtifacts,
  },
  experimental: {
    serverActions: {
      // Images (assistant avatars, org logos, profile photos) no longer travel
      // through Server Actions as base64 — they upload their binary directly to
      // object storage (see lib/storage/assets.ts). The cap that remains is
      // solely for knowledge file uploads, whose Server Action would otherwise
      // hit the default 1 MB limit and reject most PDFs. Vercel still enforces
      // its own ~4.5 MB request body limit, so larger files need a
      // direct-to-storage path.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
