-- Knowledge-file originals in Supabase Storage.
--
-- The uploaded binary is retained so a Source can be re-ingested (extract →
-- enrich → chunk → embed) after the pipeline improves, without the admin
-- re-uploading. Unlike `public-assets` (widget-visible avatars, public read),
-- originals are NOT public: this bucket stays private and every object policy
-- is org-scoped, so one org's files are unreadable to another. Object paths
-- carry the owning org in the second segment:
--   org/{organizationId}/knowledge/{random}.{ext}
-- Server-side reads use the service role (bypasses RLS); these policies are
-- defense-in-depth for any authenticated client access.

insert into storage.buckets (id, name, public, file_size_limit)
values (
  'knowledge-originals',
  'knowledge-originals',
  false,
  26214400
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "org members read knowledge originals" on storage.objects;
create policy "org members read knowledge originals"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'knowledge-originals'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "org members insert knowledge originals" on storage.objects;
create policy "org members insert knowledge originals"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'knowledge-originals'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin', 'editor')
    )
  );

drop policy if exists "org members update knowledge originals" on storage.objects;
create policy "org members update knowledge originals"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'knowledge-originals'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin', 'editor')
    )
  )
  with check (
    bucket_id = 'knowledge-originals'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin', 'editor')
    )
  );

drop policy if exists "org members delete knowledge originals" on storage.objects;
create policy "org members delete knowledge originals"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'knowledge-originals'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin', 'editor')
    )
  );

-- Storage reference on the Source: null for pasted text / URLs / websites and
-- for files uploaded before originals were retained (those can't re-process).
alter table public.sources
  add column if not exists original_object_path text;

comment on column public.sources.original_object_path is
  'Storage key of the uploaded original file; null when no original is retained.';
