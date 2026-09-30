-- An approved action can be run again after its run failed (#958).
--
-- Deciding and running were one step: the decision's compare-and-set closed
-- the row, then the action ran. A run that threw left the row approved with
-- `executed_at` null, and the next click read "already decided", so the action
-- the Member said yes to could never run. Running is now its own
-- compare-and-set on this column: the first click to claim an approved,
-- unrun row runs it, a failure clears the claim, and a claim whose function
-- died without settling is taken over once it is older than the lease the
-- operation passes (longer than any function's `maxDuration`).
--
-- Additive and nullable, so a deploy that reads rows before this lands is
-- unaffected; only the claim itself needs the column.

alter table public.action_approvals
  add column run_claimed_at timestamptz;

comment on column public.action_approvals.run_claimed_at is
  'When the current run of an approved action was claimed. Cleared when that run fails, so the Member can retry; a claim older than the lease is taken over.';
