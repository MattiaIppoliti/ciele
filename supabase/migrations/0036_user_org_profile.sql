-- User profile fields (username, name, avatar) and org branding (logo) --
-- profiles only had `email` (0003's "mirror of auth.users"); organizations
-- only had `name`. Needed for the Settings > Profile page and org branding
-- editing (admin+, same rank as Members management).

alter table public.profiles
  add column username text,
  add column first_name text not null default '',
  add column last_name text not null default '',
  add column avatar_url text;

-- Backfill: default username to the email local-part for every profile that
-- predates this column (mirrors what handle_new_user now does for new signups).
update public.profiles
set username = nullif(split_part(email, '@', 1), '')
where username is null;

-- handle_new_user (moved to `private` in 0018, redefined in 0034 for the
-- superuser allowlist) — replace again to seed username on signup. Only the
-- insert's default changes; the on-conflict branch still only touches email,
-- so re-running this trigger never clobbers a username the user has since set.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, username)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), '')
  )
  on conflict (id) do update set email = excluded.email;
  if exists (
    select 1 from private.platform_superuser_emails
    where email = lower(coalesce(new.email, ''))
  ) then
    insert into private.platform_superusers (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

-- profiles never had an UPDATE policy — only "read profiles of shared orgs"
-- (select). Needed for the Settings > Profile page to actually persist.
create policy "users update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Org branding: a circular logo, like an assistant's. Broaden the org UPDATE
-- policy from owner-only to admin+ — the same rank the rest of the schema
-- uses for "can manage this org" (canManageMembers in rbac.ts).
alter table public.organizations
  add column logo_url text;

drop policy if exists "owner updates org" on public.organizations;
create policy "admins update org" on public.organizations
  for update using (private.has_org_role(id, 3)) with check (private.has_org_role(id, 3));
