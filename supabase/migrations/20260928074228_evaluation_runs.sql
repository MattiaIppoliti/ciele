-- Synthetic evaluations (Eval) create no Conversation, so the Inbox and the
-- Insights conversation population never see them. Their model spend is still
-- metered, as the `evaluation` stage on the `preview` surface.
create table public.evaluation_datasets (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  examples jsonb not null check (jsonb_typeof(examples) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index evaluation_datasets_org_created_idx
  on public.evaluation_datasets (organization_id, created_at desc);

create table public.evaluation_runs (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assistant_id text not null,
  assistant_name text not null,
  assistant_model jsonb not null,
  dataset_id text not null,
  dataset_name text not null,
  examples jsonb not null check (jsonb_typeof(examples) = 'array'),
  stage text not null check (stage in ('answer','classifier','orchestration','fallback','preflight','reranker')),
  candidates jsonb not null check (jsonb_typeof(candidates) = 'array'),
  status text not null default 'running' check (status in ('running','completed','failed')),
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array'),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index evaluation_runs_org_created_idx
  on public.evaluation_runs (organization_id, created_at desc);
create index evaluation_runs_dataset_idx on public.evaluation_runs (dataset_id);
create index evaluation_runs_assistant_idx on public.evaluation_runs (assistant_id);

alter table public.evaluation_datasets enable row level security;
alter table public.evaluation_runs enable row level security;
create policy "members read evaluation datasets" on public.evaluation_datasets
  for select using (private.is_org_member(organization_id));
create policy "editors create evaluation datasets" on public.evaluation_datasets
  for insert with check (private.has_org_role(organization_id, 2));
create policy "editors update evaluation datasets" on public.evaluation_datasets
  for update using (private.has_org_role(organization_id, 2))
  with check (private.has_org_role(organization_id, 2));
create policy "editors delete evaluation datasets" on public.evaluation_datasets
  for delete using (private.has_org_role(organization_id, 2));
create policy "members read evaluation runs" on public.evaluation_runs
  for select using (private.is_org_member(organization_id));
-- Inside each subquery an unqualified `organization_id` binds to the subquery's
-- own table, which makes the comparison a tautology. Every outer reference is
-- therefore qualified with `evaluation_runs.`.
create policy "editors create evaluation runs" on public.evaluation_runs
  for insert with check (
    private.has_org_role(organization_id, 2)
    and exists (
      select 1 from public.assistants a
      where a.id = evaluation_runs.assistant_id
        and a.organization_id = evaluation_runs.organization_id
    )
    and exists (
      select 1 from public.evaluation_datasets d
      where d.id = evaluation_runs.dataset_id
        and d.organization_id = evaluation_runs.organization_id
    )
  );
create policy "editors update evaluation runs" on public.evaluation_runs
  for update using (private.has_org_role(organization_id, 2))
  with check (
    private.has_org_role(organization_id, 2)
    and exists (
      select 1 from public.assistants a
      where a.id = evaluation_runs.assistant_id
        and a.organization_id = evaluation_runs.organization_id
    )
    and exists (
      select 1 from public.evaluation_datasets d
      where d.id = evaluation_runs.dataset_id
        and d.organization_id = evaluation_runs.organization_id
    )
  );

alter table public.ai_usage drop constraint if exists ai_usage_stage_check;
alter table public.ai_usage add constraint ai_usage_stage_check
  check (stage in (
    'classify', 'generate', 'embed', 'enrich', 'verify', 'goal_eval',
    'evaluation', 'compost', 'improvement_proposal', 'graph_search',
    'graph_cognify', 'rerank', 'memory_extract', 'agent_memory', 'decide'
  ));
