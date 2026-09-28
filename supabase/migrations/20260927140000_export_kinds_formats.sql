-- Insights exports choose what they contain and how they are packaged: the
-- Create export dialog offers three report kinds and three file types, where
-- the first release had one of each.
--
-- Additive only. The old values stay legal, so a job queued before this runs
-- still completes, and the app code that writes the new values tolerates the
-- window before the applier gets here: the insert fails with a constraint
-- error the action surfaces, rather than a row the worker cannot read.
--
-- The export name and filter snapshot live in the existing `params` jsonb, so
-- they need no column.

alter table public.export_jobs drop constraint if exists export_jobs_kind_check;
alter table public.export_jobs
  add constraint export_jobs_kind_check
  check (kind in ('insights_overview', 'insights_datapoints', 'insights_languages'));

alter table public.export_jobs drop constraint if exists export_jobs_format_check;
alter table public.export_jobs
  add constraint export_jobs_format_check
  check (format in ('csv', 'json', 'xlsx'));

-- The private bucket refuses any object whose type it does not list, so the
-- two new formats have to be allowed at the storage seam as well.
update storage.buckets
set allowed_mime_types = array[
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
where id = 'analytics-exports';
