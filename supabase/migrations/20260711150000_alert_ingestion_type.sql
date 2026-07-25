-- Knowledge-ingestion failures (enrich → persist → embed) are an
-- operational-health signal distinct from website crawls: they get their own
-- Alert type so the /alerts surface can label them apart from `crawl`.

alter table public.alerts
  drop constraint if exists alerts_type_check;

alter table public.alerts
  add constraint alerts_type_check
  check (type in ('integration', 'crawl', 'provider', 'ingestion', 'system'));
