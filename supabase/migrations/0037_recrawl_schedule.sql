-- Per-site re-crawl schedule for website sources.
--
-- recrawl_schedule: how often a website source re-crawls itself. "never"
--   means manual re-crawl only (the default for every kind). A future cron
--   sweep (map ticket "Durable job layer") selects due sources by comparing
--   last_crawled_at + cadence against now(); this migration only stores the
--   inputs, it does not schedule anything.
-- last_crawled_at: set when a crawl completes successfully (finalize), NOT on
--   edit — so next-due stays accurate when an admin only renames a source.
--
-- Per-page override seam: a future page-level schedule column on `concepts`
-- (crawled pages) will inherit this site-level schedule when left null. The
-- same next-due derivation serves both once that seam is built.

alter table public.sources
  add column if not exists recrawl_schedule text not null default 'never'
    check (recrawl_schedule in ('daily', 'weekly', 'monthly', 'never')),
  add column if not exists last_crawled_at timestamptz;

comment on column public.sources.recrawl_schedule is
  'Re-crawl cadence for website sources; "never" = manual only.';
comment on column public.sources.last_crawled_at is
  'Last successful crawl completion; null until a crawl finishes.';
