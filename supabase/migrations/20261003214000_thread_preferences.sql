-- Personal triage, separate from transcripts and shared group lifecycle.
create table public.thread_preferences (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text references public.conversations(id) on delete cascade,
  channel_id text references public.teammate_channels(id) on delete cascade,
  action text not null check (action in ('archive', 'flag')),
  created_at timestamptz not null default now(),
  check (num_nonnulls(conversation_id, channel_id) = 1)
);
create unique index thread_preferences_conversation_unique
  on public.thread_preferences(organization_id, user_id, conversation_id, action) where conversation_id is not null;
create unique index thread_preferences_channel_unique
  on public.thread_preferences(organization_id, user_id, channel_id, action) where channel_id is not null;
create index thread_preferences_member_idx on public.thread_preferences(organization_id, user_id, created_at);
alter table public.thread_preferences enable row level security;
create policy "read own thread preferences" on public.thread_preferences for select using (
  user_id = (select auth.uid()) and private.is_org_member(organization_id)
);
create policy "remove own thread preferences" on public.thread_preferences for delete using (
  user_id = (select auth.uid()) and private.is_org_member(organization_id)
);
create policy "triage accessible threads" on public.thread_preferences for insert with check (
  user_id = (select auth.uid()) and private.is_org_member(organization_id)
  and (
    (channel_id is not null and exists (
      select 1 from public.teammate_channels c
      where c.id = channel_id and c.organization_id = thread_preferences.organization_id
      and private.is_channel_member(c.id)
    ))
    or (conversation_id is not null and exists (
      select 1 from public.conversations c
      left join public.assistants a on a.id = c.assistant_id
      left join public.teammates t on t.id = c.teammate_id
      where c.id = conversation_id and (
        a.organization_id = thread_preferences.organization_id
        or (t.organization_id = thread_preferences.organization_id
          and c.subject_type = 'member' and c.subject_id = (select auth.uid())::text
          and (t.visibility = 'org' or t.owner_id = (select auth.uid())
            or t.editor_ids @> to_jsonb((select auth.uid())::text)
            or private.has_org_role(t.organization_id, 3)))
      )
    ))
  )
);
grant select, insert, delete on public.thread_preferences to authenticated;
grant all on public.thread_preferences to service_role;
notify pgrst, 'reload schema';
