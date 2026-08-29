-- Signup-exception allowlist (#434). The consumer-domain signup block (0022)
-- hardcoded a personal email as its exact-email exception. The exception list
-- is now deployment config: private.signup_email_exceptions, EMPTY BY DEFAULT
--, a fresh deployment blocks every consumer domain until an operator inserts
-- a row (service role / SQL console). This table is the single source of
-- truth: there is no client-side copy of the list (self-serve signup is
-- closed, so the trigger's error message is the only user-facing surface).
--
-- (0022 is a baseline file edited in place for fresh deployments; this
-- migration brings the LIVE project's trigger function to the same
-- definition. Existing accounts are unaffected, the trigger only gates new
-- auth.users inserts.)

create table if not exists private.signup_email_exceptions (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

-- RLS with no policies: invisible to every app role; only the service role
-- and the security-definer trigger below read it.
alter table private.signup_email_exceptions enable row level security;

create or replace function public.reject_consumer_email_domains()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  domain text;
  blocked_domains text[] := array[
    'gmail.com', 'googlemail.com',
    'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'yahoo.com', 'yahoo.co.uk',
    'icloud.com', 'me.com', 'mac.com',
    'aol.com',
    'protonmail.com', 'proton.me',
    'gmx.com', 'mail.com', 'zoho.com', 'yandex.com'
  ];
begin
  if new.email is null then
    return new;
  end if;
  if exists (
    select 1 from private.signup_email_exceptions
    where email = lower(new.email)
  ) then
    return new;
  end if;
  domain := lower(split_part(new.email, '@', 2));
  if domain = any (blocked_domains) then
    raise exception 'Please sign up with your company or institution email address.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
