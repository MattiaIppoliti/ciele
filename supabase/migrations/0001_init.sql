-- Assistants: the top-level agents managed from the admin superapp.
create table if not exists public.assistants (
  id text primary key,
  title text not null,
  nickname text not null default '',
  description text not null default '',
  welcome_message text not null default '',
  suggested_questions text[] not null default '{}',
  chat_launcher_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Flows: routing rules attached to an assistant (Flows tab).
create table if not exists public.flows (
  id text primary key,
  assistant_id text not null references public.assistants (id) on delete cascade,
  name text not null,
  description text not null default '',
  built_in boolean not null default false,
  enabled boolean not null default true,
  position integer not null default 0,
  actions text[] not null default '{}',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists flows_assistant_id_idx on public.flows (assistant_id);

alter table public.assistants enable row level security;
alter table public.flows enable row level security;

-- Demo policies: open access via anon key. Replace with auth-scoped
-- policies before going to production.
create policy "assistants full access" on public.assistants
  for all using (true) with check (true);

create policy "flows full access" on public.flows
  for all using (true) with check (true);
