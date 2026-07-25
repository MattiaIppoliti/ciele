-- AI runtime: provider connections (ADR-0001), per-assistant model,
-- conversations & messages (history + feedback).

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type text not null check (type in ('platform', 'subscription', 'api_key')),
  provider text not null check (provider in ('anthropic', 'openai', 'google')),
  display_name text not null default '',
  -- AES-256-GCM ciphertext, encrypted app-side with APP_ENCRYPTION_KEY.
  encrypted_key text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index provider_connections_org_idx on public.provider_connections (organization_id);

alter table public.provider_connections enable row level security;

create policy "members read connections" on public.provider_connections
  for select using (public.is_org_member(organization_id));
create policy "admins manage connections" on public.provider_connections
  for insert with check (public.has_org_role(organization_id, 3));
create policy "admins delete connections" on public.provider_connections
  for delete using (public.has_org_role(organization_id, 3));

alter table public.assistants
  add column if not exists model_provider text not null default 'anthropic',
  add column if not exists model_id text not null default 'claude-opus-4-8';

-- Conversations: one thread between a subject (member in Preview, visitor in
-- the published widget) and an assistant.
create table public.conversations (
  id text primary key,
  assistant_id text not null references public.assistants (id) on delete cascade,
  subject_type text not null check (subject_type in ('member', 'visitor')),
  subject_id text not null,
  collection_id text,
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_assistant_subject_idx
  on public.conversations (assistant_id, subject_type, subject_id, updated_at desc);

create table public.messages (
  id text primary key,
  conversation_id text not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- Array of reply parts (text / help_desk / follow_ups) for assistant
  -- messages, [{type:'text', text}] for user messages.
  content jsonb not null default '[]',
  flow_id text,
  flow_name text,
  feedback smallint not null default 0 check (feedback in (-1, 0, 1)),
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Admin preview: members of the assistant's org access their own conversations.
-- Widget visitors are served by API routes (service role) in a later phase.
create policy "members read own conversations" on public.conversations
  for select using (exists (
    select 1 from public.assistants a
    where a.id = conversations.assistant_id and public.is_org_member(a.organization_id)
  ));
create policy "members write own conversations" on public.conversations
  for insert with check (exists (
    select 1 from public.assistants a
    where a.id = conversations.assistant_id and public.is_org_member(a.organization_id)
  ));
create policy "members update own conversations" on public.conversations
  for update using (subject_type = 'member' and subject_id = auth.uid()::text);
create policy "members delete own conversations" on public.conversations
  for delete using (subject_type = 'member' and subject_id = auth.uid()::text);

create policy "members read messages" on public.messages
  for select using (exists (
    select 1 from public.conversations c
    join public.assistants a on a.id = c.assistant_id
    where c.id = messages.conversation_id and public.is_org_member(a.organization_id)
  ));
create policy "members write messages" on public.messages
  for insert with check (exists (
    select 1 from public.conversations c
    join public.assistants a on a.id = c.assistant_id
    where c.id = messages.conversation_id and public.is_org_member(a.organization_id)
  ));
create policy "members update messages" on public.messages
  for update using (exists (
    select 1 from public.conversations c
    join public.assistants a on a.id = c.assistant_id
    where c.id = messages.conversation_id and public.is_org_member(a.organization_id)
  ));
