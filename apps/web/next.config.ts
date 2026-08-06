import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { CONNECTOR_FILENAME } from "./src/lib/local-connector-installer";

// The filename comes from the same constant the runtime route reads, so a
// connector bump can never leave the trace list pointing at a stale version.
// A missing artifact fails the build here rather than shipping a standalone
// image whose /api/local-connector/runtime returns 503 (dev and Vercel serve
// public/ directly, so only the Docker build would notice).
const connectorArtifact = `./public/connectors/${CONNECTOR_FILENAME}`;
if (!existsSync(connectorArtifact)) {
  throw new Error(
    `Connector runtime missing: ${connectorArtifact}. Add the release artifact or update CURRENT_CONNECTOR_VERSION.`
  );
}

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
  images: {
    // AVIF first, WebP second (Next's default is WebP alone). The marketing
    // hero's two painterly clouds are the heaviest images the public site
    // serves and they are `priority`, so they are preloaded — AVIF typically
    // lands 20-30% under WebP on exactly this kind of soft-gradient artwork.
    // The cost is a slower first optimization per size; the result is cached.
    formats: ["image/avif", "image/webp"],
  },
  outputFileTracingIncludes: {
    // The runtime route reads this file at request time; trace it into the
    // standalone bundle. The terminal one-liner is served from here too.
    "/api/local-connector/runtime": [connectorArtifact],
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
