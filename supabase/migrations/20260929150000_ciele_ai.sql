-- Ciele AI: the Organization's default AI layer.
--
-- One system Teammate per Organization, created on first use, that talks to the
-- whole admin platform on behalf of whoever is chatting with it. It is a
-- Teammate row so it gets the same chat, history, rename and model picker as
-- any other, but it acts with the **Member's own** Role (the same boundary an
-- API key of theirs would have), never with grants of its own, so it can never
-- do for a Viewer what a Viewer could not do in the console.
--
-- The kind joins the existing check. The inline check from the Flows Agent
-- migration was created without a name, so it is looked up rather than
-- guessed: a wrong name would make `drop constraint if exists` a silent no-op
-- and the insert below it would then fail on the old list.

do $$
declare
  existing text;
begin
  for existing in
    select con.conname
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.conrelid = 'public.teammates'::regclass
      and con.contype = 'c'
      and att.attname = 'system_kind'
  loop
    execute format('alter table public.teammates drop constraint %I', existing);
  end loop;
end $$;

alter table public.teammates
  add constraint teammates_system_kind_check
  check (system_kind in ('flows_agent', 'ciele_ai'));

comment on column public.teammates.system_kind is
  'Null for a Member-created Teammate. flows_agent: the Flow Canvas agent (#838). ciele_ai: the Organization''s default AI layer, one per Organization.';

-- One Ciele AI per Organization. The per-Assistant index cannot say this: its
-- key includes assistant_id, which is null here, and nulls never collide.
create unique index teammates_ciele_ai_uidx
  on public.teammates (organization_id)
  where system_kind = 'ciele_ai';
