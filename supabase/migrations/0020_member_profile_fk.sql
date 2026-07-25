-- Member lists join profiles in one query (PostgREST embeds need a direct
-- FK). profiles was created (0003) precisely as "a profile mirror of
-- auth.users so member lists can show emails under RLS" — this makes that
-- relationship explicit.
--
-- Backfill first: the handle_new_user trigger (0003) has created a profile
-- for every user since it was installed; this covers any auth users that
-- predate it.
insert into public.profiles (id, email)
select u.id, coalesce(u.email, '')
from auth.users u
on conflict (id) do nothing;

-- on delete cascade mirrors the existing auth.users cascades: a profile row
-- only ever disappears when the auth user does, which already cascades to
-- organization_members through its auth.users FK.
alter table public.organization_members
  add constraint organization_members_user_id_profiles_fk
  foreign key (user_id) references public.profiles (id) on delete cascade;
