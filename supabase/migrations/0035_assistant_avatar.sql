-- Circular assistant logo shown in the sidebar Overview row and the
-- assistant editor's General panel. Stored as a data URL (small image,
-- no dedicated object storage bucket exists yet) — nullable, falls back to
-- the brand-color swatch when unset.
alter table public.assistants
  add column avatar_url text;
