-- Backfill: this was applied directly to the live project
-- on 2026-07-03 without ever being captured as a local migration file. Added
-- here so a fresh environment built from this repo matches production.
--
-- Security lint: pin search_path on functions that lacked it.
alter function public.role_rank(public.org_role) set search_path = public;
alter function public.match_chunks(text, text, vector, int) set search_path = public;
