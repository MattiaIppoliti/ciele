-- A timestamp is not an ordering key: PGlite and some imported histories can
-- write several channel messages in one tick. Give tail reads the same stable
-- insertion sequence ordinary Conversation messages already use.

alter table public.teammate_channel_messages
  add column if not exists seq bigint generated always as identity;

drop index if exists public.teammate_channel_messages_channel_idx;
create index teammate_channel_messages_channel_idx
  on public.teammate_channel_messages (channel_id, seq);
