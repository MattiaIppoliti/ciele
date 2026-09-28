-- Knowledge accepts PowerPoint (.pptx) and Excel (.xlsx) originals.
--
-- The extractor has read both since chat attachments needed them
-- (packages/agent/src/ooxml.ts), and document triage already treats them as
-- OOXML, but the upload allowlist in apps/web/src/lib/storage/assets.ts and
-- this bucket did not list them, so a deck or a workbook could only ever be a
-- one-conversation attachment, never Knowledge.
--
-- The bucket refuses any type it does not list, so the full list is restated
-- rather than appended to. `assets.test.ts` asserts that the newest migration
-- setting it covers every type the uploader writes.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/octet-stream'
]
where id = 'knowledge-originals';
