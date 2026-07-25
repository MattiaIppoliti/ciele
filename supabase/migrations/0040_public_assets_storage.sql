-- Public widget/admin images live in Supabase Storage. Object paths are
-- org-scoped and random-name only:
-- org/{organizationId}/avatars/{assistant|organization|profile}/{random}.{ext}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'public-assets',
  'public-assets',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read public assets" on storage.objects;
create policy "public read public assets"
  on storage.objects for select
  to public
  using (bucket_id = 'public-assets');

drop policy if exists "org members insert public assets" on storage.objects;
create policy "org members insert public assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'public-assets'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin', 'editor')
    )
  );

drop policy if exists "org members update public assets" on storage.objects;
create policy "org members update public assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'public-assets'
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
    bucket_id = 'public-assets'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin', 'editor')
    )
  );

drop policy if exists "org members delete public assets" on storage.objects;
create policy "org members delete public assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'public-assets'
    and (storage.foldername(name))[1] = 'org'
    and exists (
      select 1
      from public.organization_members m
      where m.organization_id::text = (storage.foldername(name))[2]
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin', 'editor')
    )
  );
