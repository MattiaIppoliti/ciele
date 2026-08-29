-- The hidden org-staff Data Assistant surface was retired. Its entity
-- selection no longer has a reader or writer, so remove the dead storage.
alter table public.organizations
  drop column if exists data_assistant_entities;
