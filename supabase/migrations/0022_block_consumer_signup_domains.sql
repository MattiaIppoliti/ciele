-- Reject new auth.users signups from common consumer email domains, except
-- a short exact-email exception list (accounts provisioned before this
-- restriction existed). Enforced here rather than only in the client
-- because apps/web's signup form calls supabase.auth.signUp() directly
-- from the browser with the anon key — there is no server action in front
-- of it to gate otherwise. Applies to every app backed by this Supabase
-- project, since they share one auth.users table; keep the domain list in
-- sync with apps/web/src/lib/email-domain.ts (client-side copy, for
-- immediate UX feedback before hitting this trigger).
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
  domain := lower(split_part(new.email, '@', 2));
  if domain = any (blocked_domains) then
    raise exception 'Please sign up with your company or institution email address.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_consumer_email_domains on auth.users;
create trigger reject_consumer_email_domains
  before insert on auth.users
  for each row
  execute function public.reject_consumer_email_domains();
