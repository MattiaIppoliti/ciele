-- Website sources keep their crawl configuration (for edit + re-crawl);
-- crawled pages (concepts) can be excluded from the assistant knowledge.

alter table public.sources
  add column if not exists config jsonb not null default '{}',
  add column if not exists updated_at timestamptz not null default now();

alter table public.concepts
  add column if not exists excluded boolean not null default false;
