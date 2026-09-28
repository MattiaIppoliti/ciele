-- Extra Eval chat models are global platform configuration. Only the service
-- role can read or write them; the app publishes safe catalog metadata to
-- authenticated organization members after checking their membership.
create table public.platform_eval_models (
  provider text not null check (provider in ('google', 'anthropic', 'openai')),
  model_id text not null check (length(model_id) between 1 and 160),
  label text not null check (length(label) between 1 and 100),
  input_eur_per_million numeric(12, 6) not null check (input_eur_per_million >= 0),
  output_eur_per_million numeric(12, 6) not null check (output_eur_per_million >= 0),
  added_by text not null,
  created_at timestamptz not null default now(),
  primary key (provider, model_id)
);

alter table public.platform_eval_models enable row level security;
revoke all on public.platform_eval_models from anon, authenticated;
