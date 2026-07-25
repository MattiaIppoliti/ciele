-- Per-assistant Knowledge Engine (ADR-0017): which retrieval engine answers
-- `search_knowledge`. `graph` is the default/primary — cognee's derived
-- Knowledge Graph — falling back to `vector` (the pgvector RAG) when the graph
-- worker is unreachable. OKF stays the record and citation anchor for both.
alter table public.assistants
  add column knowledge_engine text not null default 'graph'
  check (knowledge_engine in ('graph', 'vector'));
