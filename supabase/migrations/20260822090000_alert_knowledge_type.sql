-- A Teammate's Knowledge Scope can outlive the Collection it names (#769).
-- Deleting a Collection that a Teammate still searches is a configuration
-- problem, not a pipeline failure: no retry fixes it, a person decides what the
-- scope should say. It gets its own Alert type so /alerts can say which kind of
-- problem it is, the same reason `ingestion` got one in
-- 20260711150000_alert_ingestion_type.sql.
alter table public.alerts
  drop constraint if exists alerts_type_check;

alter table public.alerts
  add constraint alerts_type_check
  check (type in ('integration', 'crawl', 'provider', 'ingestion', 'knowledge', 'system'));
