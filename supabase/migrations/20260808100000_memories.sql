-- Long-term memories (spec ciele-org#660, ticket ciele-org#664).
--
-- Per-end-user durable facts, promoted from Conversations by a background
-- extraction job and recalled semantically at the start of the user's next
-- conversation. Memories key on the verified SSO subject *within* the
-- Organization (ADR-0018): never on client-generated visitor ids, and the
-- whole capability sits behind an org-level toggle, off by default.

-- The org-level capability toggle (mirrors compost_opt_out's shape).
alter table public.organizations
  add column memory_enabled boolean not null default false;

create table public.memories (
  id text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- The verified OIDC subject (sealed gate cookie, ADR-0018): org-scoped.
  subject_id text not null,
  text text not null,
  -- The platform's shared 1536-dim embedding convention (ARCHITECTURE §7);
  -- null when no embedding connection was configured at write time.
  embedding vector(1536),
  -- Provenance: the Conversation the fact was extracted from.
  conversation_id text references public.conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memories_org_subject_idx
  on public.memories (organization_id, subject_id, created_at desc);

create index if not exists memories_embedding_idx
  on public.memories using hnsw (embedding vector_cosine_ops);

alter table public.memories enable row level security;

-- Admin surfaces: members read (lookup), editors write/delete (erasure).
-- Widget + extraction-job traffic runs on the service role and bypasses RLS.
create policy "members read memories" on public.memories
  for select using (private.is_org_member(organization_id));
create policy "editors create memories" on public.memories
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update memories" on public.memories
  for update using (private.has_org_role(organization_id, 2));
create policy "editors delete memories" on public.memories
  for delete using (private.has_org_role(organization_id, 2));

-- Top-k semantic recall over one subject's memories, the match_chunks
-- pattern (0005_knowledge) scoped by (organization, subject).
create or replace function public.match_memories(
  p_organization_id uuid,
  p_subject_id text,
  p_query_embedding vector(1536),
  p_match_count int default 5
)
returns table (
  id text,
  text text,
  similarity float
)
language sql stable as $$
  select
    m.id,
    m.text,
    1 - (m.embedding <=> p_query_embedding) as similarity
  from public.memories m
  where m.organization_id = p_organization_id
    and m.subject_id = p_subject_id
    and m.embedding is not null
  order by m.embedding <=> p_query_embedding
  limit p_match_count
$$;

alter function public.match_memories(uuid, text, vector, int) set search_path = public;

-- New durable job kind: promote_memories extracts durable facts from a
-- conversation that went quiet (background only, zero chat latency).
alter table public.background_jobs
  drop constraint if exists background_jobs_kind_check;

alter table public.background_jobs
  add constraint background_jobs_kind_check
  check (kind in (
    'ingest_source',
    'graph_sync_concept',
    'draft_improvement_proposal',
    'promote_memories'
  ));

-- Extraction spend is metered like every other model call; the new stage
-- keeps it attributable (and countable against the org's daily budget).
alter table public.ai_usage
  drop constraint if exists ai_usage_stage_check;

alter table public.ai_usage
  add constraint ai_usage_stage_check
  check (stage in (
    'classify',
    'generate',
    'embed',
    'enrich',
    'verify',
    'goal_eval',
    'compost',
    'improvement_proposal',
    'graph_search',
    'graph_cognify',
    'memory_extract'
  ));
