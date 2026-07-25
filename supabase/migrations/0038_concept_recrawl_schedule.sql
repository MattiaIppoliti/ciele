-- Per-page re-crawl override on crawled pages (concepts).
--
-- This realizes the seam documented in 0037_recrawl_schedule.sql: a page may
-- override the site-level cadence set on its website source. NULL means the
-- page inherits the source's recrawl_schedule (see `effectivePageSchedule`),
-- which is why this column is nullable with no default — unlike the
-- source-level column, "unset" is a meaningful state (inherit), not "never".

alter table public.concepts
  add column if not exists recrawl_schedule text
    check (recrawl_schedule in ('daily', 'weekly', 'monthly', 'never'));

comment on column public.concepts.recrawl_schedule is
  'Per-page re-crawl override; null inherits the website source schedule.';
