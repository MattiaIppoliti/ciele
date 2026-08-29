# Object storage for images and knowledge originals

## Status

Accepted.

## Context

Assistant avatars, Organization logos, and Member profile avatars are currently
stored as base64 data URLs in Postgres text columns. This bloats rows, makes
ordinary profile edits carry binary payloads, and forced the web app to raise
the Server Action body size limit. Uploaded knowledge files are parsed to text
and discarded, so future re-chunking, re-embedding, or extraction improvements
cannot reprocess the original artifact.

Supabase Storage fits the platform policy because it is already part of the
chosen backend, uses Storage buckets with public/private access models, and
uses Postgres RLS policies for protected operations. Supabase documents public
buckets as suitable for profile pictures/public media, private buckets as
RLS-protected with signed URLs, and Storage egress as part of the existing
Supabase bandwidth accounting.

Sources:

- Bucket access models:
  https://supabase.com/docs/guides/storage/buckets/fundamentals
- Storage access control and RLS:
  https://supabase.com/docs/guides/storage/security/access-control
- Serving public/private assets and signed URLs:
  https://supabase.com/docs/guides/storage/serving/downloads
- Bandwidth and Storage egress:
  https://supabase.com/docs/guides/storage/serving/bandwidth
- Image transformation availability:
  https://supabase.com/docs/guides/storage/serving/image-transformations

## Decision

Use Supabase Storage for binary assets.

Create two bucket classes:

- `public-assets`: public bucket for browser/widget-served images: Assistant
  avatars, Organization logos, and Member profile avatars. Persist only the
  public URL or storage path in existing `avatarUrl`/`logoUrl` fields. Object
  paths must include the Organization id and a random filename, not user-entered
  names: `org/{organizationId}/avatars/{kind}/{random}.{ext}`.
- `knowledge-originals`: private bucket for uploaded source files. Persist the
  object path, original filename, MIME type, size, and checksum in Source
  `config`. Runtime ingestion reads originals server-side with the service role;
  future admin download/reprocess UI uses short-lived signed URLs.

Do not use Supabase image transformations in the first implementation because
the docs state resizing is Pro-plan-only. Store already-normalized thumbnail
sizes for avatars if the UI needs smaller variants; otherwise serve the original
bounded upload size.

## Migration Plan

1. Add Storage buckets and RLS policies:
   - authenticated org members may upload/update/delete only objects under
     their Organization prefix for `public-assets`;
   - `knowledge-originals` is private; server-side actions use the service role
     for upload/read/delete, and member access is mediated by app routes or
     signed URLs.
2. Change image uploads from client-side base64 data URLs to file upload
   actions that write Storage objects and save URLs/paths.
3. Change knowledge file upload to store the original in
   `knowledge-originals` before extraction, then keep using the existing text
   extraction pipeline.
4. Keep existing base64 values valid during rollout. Add a background migration
   later that uploads existing base64 images to `public-assets` and replaces
   columns with Storage URLs. Historical knowledge-file originals cannot be
   backfilled because they were discarded.

## Rejected Options

- **Keep base64 in Postgres**: simple but row-bloating, payload-heavy, and does
  not solve discarded knowledge originals.
- **Vercel Blob**: good product fit, but adds another paid/storage surface when
  Supabase Storage already exists in the stack.
- **S3/R2 directly**: scalable, but violates the Vercel + Supabase first policy
  for the current 1-5 organization horizon.

## Consequences

- Database rows hold references, not binary blobs.
- Widget-visible images get CDN-friendly public URLs.
- Knowledge ingestion becomes reproducible because future pipelines can read
  original files again.
- Storage egress becomes a monitored Supabase usage dimension. Large public
  media libraries remain out of scope for this phase.
