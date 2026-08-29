-- Superuser enrollment becomes allowlist-driven (#431). The signup trigger
-- previously auto-enrolled a hardcoded personal email as a platform superuser
-- (cross-org RLS bypass, 0034/0036). That literal is gone: enrollment now
-- reads private.platform_superuser_emails, a deployment-configured table that
-- is EMPTY BY DEFAULT, a fresh deployment grants zero platform superusers
-- until an operator explicitly inserts a row (service role / SQL console).
--
-- Already-enrolled accounts in private.platform_superusers are untouched:
-- this changes who *becomes* a superuser at signup, not who is one now.
-- (0034/0036 are baseline files edited in place for fresh deployments; this
-- migration brings the LIVE project's trigger to the same definition.)

create table if not exists private.platform_superuser_emails (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

-- RLS with no policies: invisible to every app role; only the service role
-- and the security-definer trigger below can read it.
alter table private.platform_superuser_emails enable row level security;

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
