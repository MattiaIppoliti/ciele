-- Knowledge as OKF bundles (ADR-0002): collections → sources → concepts,
-- with pgvector chunks for RAG. Embeddings are zero-padded to 1536 dims so
-- different embedding models share one column.

create extension if not exists vector;

create table public.knowledge_collections (
  id text primary key,
  assistant_id text not null references public.assistants (id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create index knowledge_collections_assistant_idx
  on public.knowledge_collections (assistant_id);

create table public.sources (
  id text primary key,
  collection_id text not null references public.knowledge_collections (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('file', 'url', 'text')),
  status text not null default 'processing' check (status in ('processing', 'ready', 'error')),
  error text not null default '',
  created_at timestamptz not null default now()
);

create index sources_collection_idx on public.sources (collection_id);

-- One OKF concept document: markdown body + YAML-style frontmatter (jsonb).
create table public.concepts (
  id text primary key,
  collection_id text not null references public.knowledge_collections (id) on delete cascade,
  source_id text references public.sources (id) on delete cascade,
  path text not null,
  frontmatter jsonb not null default '{}',
  body text not null default '',
  created_at timestamptz not null default now()
);

create index concepts_collection_idx on public.concepts (collection_id);

create table public.concept_chunks (
  id text primary key,
  concept_id text not null references public.concepts (id) on delete cascade,
  collection_id text not null references public.knowledge_collections (id) on delete cascade,
  assistant_id text not null references public.assistants (id) on delete cascade,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index concept_chunks_assistant_idx on public.concept_chunks (assistant_id);
create index concept_chunks_embedding_idx on public.concept_chunks
  using hnsw (embedding vector_cosine_ops);

-- RLS: org members of the owning assistant.
alter table public.knowledge_collections enable row level security;
alter table public.sources enable row level security;
alter table public.concepts enable row level security;
alter table public.concept_chunks enable row level security;

create policy "members all collections" on public.knowledge_collections
  for all using (exists (
    select 1 from public.assistants a
    where a.id = knowledge_collections.assistant_id
      and public.has_org_role(a.organization_id, 2)
  ));
create policy "members read collections" on public.knowledge_collections
  for select using (exists (
    select 1 from public.assistants a
    where a.id = knowledge_collections.assistant_id
      and public.is_org_member(a.organization_id)
  ));

create policy "members all sources" on public.sources
  for all using (exists (
    select 1 from public.knowledge_collections kc
    join public.assistants a on a.id = kc.assistant_id
    where kc.id = sources.collection_id and public.is_org_member(a.organization_id)
  ));

create policy "members all concepts" on public.concepts
  for all using (exists (
    select 1 from public.knowledge_collections kc
    join public.assistants a on a.id = kc.assistant_id
    where kc.id = concepts.collection_id and public.is_org_member(a.organization_id)
  ));

create policy "members all chunks" on public.concept_chunks
  for all using (exists (
    select 1 from public.assistants a
    where a.id = concept_chunks.assistant_id and public.is_org_member(a.organization_id)
  ));

-- Cosine search over chunks, optionally scoped to a collection.
create or replace function public.match_chunks(
  p_assistant_id text,
  p_collection_id text,
  p_query_embedding vector(1536),
  p_match_count int default 6
)
returns table (
  concept_id text,
  content text,
  similarity float
)
language sql stable as $$
  select
    cc.concept_id,
    cc.content,
    1 - (cc.embedding <=> p_query_embedding) as similarity
  from public.concept_chunks cc
  where cc.assistant_id = p_assistant_id
    and cc.embedding is not null
    and (p_collection_id is null or cc.collection_id = p_collection_id)
  order by cc.embedding <=> p_query_embedding
  limit p_match_count
$$;
