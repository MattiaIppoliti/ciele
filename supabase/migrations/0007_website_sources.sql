-- Knowledge modes: website crawling sources (Apify) join file/url/text.
alter table public.sources drop constraint if exists sources_kind_check;
alter table public.sources
  add constraint sources_kind_check
  check (kind in ('file', 'url', 'text', 'website'));
