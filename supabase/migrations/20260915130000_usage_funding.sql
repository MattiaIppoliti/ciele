-- Which pocket paid (#851, spec #847).
--
-- A plan allowance is a **rate**: credits per window. A top-up balance is a
-- **pool** the Organization owns until spent. The pool is drawn only once a
-- window is fully consumed, so a pack is a buffer and never a substitute for
-- the plan.
--
-- Open source on purpose, and inert without the enterprise edition: the
-- enterprise side owns the grants table, the balance and the gate's overflow
-- branch, but the ledger is one table and its rows have to be able to say which
-- pocket paid whatever edition wrote them. With no enterprise registration
-- every row is 'plan', which is exactly what a self-hosted deployment means.

alter table public.ai_usage
  add column funding text not null default 'plan'
    check (funding in ('plan', 'topup')),
  -- What this row cost, in micro-credits, at the moment it was settled.
  --
  -- Written ONLY on a 'topup' row. A plan meter is a fraction of an allowance
  -- and may follow the rate table, so plan-funded rows stay priced at read
  -- time; a pool debit is money the customer paid and must not move when a rate
  -- is corrected later. This is the one place the ledger stores a price.
  add column credits_micro bigint check (credits_micro is null or credits_micro >= 0);

comment on column public.ai_usage.funding is
  'Which pocket paid: the plan window allowance, or a purchased top-up balance once that allowance was fully consumed.';
comment on column public.ai_usage.credits_micro is
  'Cost in micro-credits, snapshotted at settle time. Only ever set on a topup-funded row: the balance is derived from grants minus these, so it must not move when a rate changes.';

-- The balance is a sum over topup rows, so the index is the one that finds them
-- for an organization. Partial, because they are a small minority of the table.
create index ai_usage_topup_idx
  on public.ai_usage (organization_id, created_at)
  where funding = 'topup';
