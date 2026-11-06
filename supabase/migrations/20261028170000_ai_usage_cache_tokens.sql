-- Prompt-cache activity per model call, as the provider reported it.
--
-- Both figures are already inside input_tokens: they say how much of the input
-- the provider served from (or wrote to) its prompt cache, not how much more
-- input there was. They exist to measure the cache before anything is priced
-- off it; the cost estimate and credits still charge every input token at the
-- full rate. Additive, defaulted, so every existing writer keeps working.

alter table public.ai_usage
  add column if not exists cache_read_tokens integer not null default 0,
  add column if not exists cache_write_tokens integer not null default 0;
