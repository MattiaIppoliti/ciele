-- Constrain the knowledge-originals bucket to the types the app actually stores.
--
-- The uploader's declared `File.type` used to be written as the object's
-- Content-Type, and Storage replays that on a signed-URL GET, so a part named
-- `notes.txt` carrying `Content-Type: text/html` rendered as markup on the
-- storage origin. The app now derives the type from the validated extension
-- (apps/web/src/lib/storage/assets.ts) and both signed URLs force an attachment
-- disposition; this is the third, server-side layer, and it brings the bucket
-- level with `public-assets` and `analytics-exports`, which have always
-- constrained their types.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/octet-stream'
]
where id = 'knowledge-originals';
