-- Per-Organization daily AI token budget (spec: usage ledger + budget alerts).
-- Null limit = unmetered. Enforcement: 'notify' raises an Alert and answers
-- normally; 'block' (later slice) skips model calls at the line.

create table public.org_budgets (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  daily_token_limit bigint,
  enforcement text not null default 'notify'
    check (enforcement in ('notify', 'block')),
  updated_at timestamptz not null default now()
);

alter table public.org_budgets enable row level security;

create policy "members read org budget" on public.org_budgets
  for select using (private.is_org_member(organization_id));
create policy "admins insert org budget" on public.org_budgets
  for insert with check (private.has_org_role(organization_id, 3));
create policy "admins update org budget" on public.org_budgets
  for update using (private.has_org_role(organization_id, 3));
create policy "admins delete org budget" on public.org_budgets
  for delete using (private.has_org_role(organization_id, 3));
