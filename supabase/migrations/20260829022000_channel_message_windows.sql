-- One bounded transcript tail per Teammate Channel. The operations read model
-- uses this for roster summaries, avoiding one database round trip per row.
create or replace function public.list_channel_message_windows(
  p_channel_ids text[],
  p_limit_per_channel integer default 30
)
returns setof public.teammate_channel_messages
language sql
stable
security invoker
set search_path = public
as $$
  select message.*
  from unnest(p_channel_ids) with ordinality
    as requested(channel_id, channel_position)
  cross join lateral (
    select row.*
    from public.teammate_channel_messages as row
    where row.channel_id = requested.channel_id
    order by row.seq desc
    limit greatest(1, least(coalesce(p_limit_per_channel, 30), 100))
  ) as message
  order by requested.channel_position asc, message.seq asc;
$$;
