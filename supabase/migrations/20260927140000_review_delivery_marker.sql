-- A Human review request is sent at most once.
--
-- The delivery job checked only whether a human had already decided. When the
-- Graph mail or Slack post succeeded and the function died before the job
-- settled, the lease expired, the ledger reclaimed the job and the assignees got
-- the request again. Two stamps around the send close that:
-- `delivery_attempted_at` just before it, `delivered_at` just after. A retry
-- that finds the first without the second cannot tell whether the send left, so
-- it raises an Alert and does not send again; one that finds `delivered_at`
-- does nothing.

alter table public.review_requests
  add column if not exists delivery_attempted_at timestamptz,
  add column if not exists delivered_at timestamptz;
