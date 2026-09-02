-- A fourth outcome on the object-access ledger: `aborted` (#801, CYB-05, from
-- the round-1 review of the ledger).
--
-- The ledger filed a download the *client* cancelled as `failed`, the value
-- reserved for our own side breaking, and the bulk-download detection counts
-- only `served`. Together those made a loophole: fetch 99% of every original
-- and cancel, and the transfer is neither a download the rule counts nor a
-- security event anyone reads. The bytes still left the building.
--
-- `aborted` names that case on its own: the caller went away with `bytes`
-- already moved. `failed` keeps meaning us. The bulk-download rule now counts
-- `served` and `aborted` together, so partial transfers are volume too.
--
-- Additive: the constraint only widens, so a deployment still writing the
-- three old values keeps working against this schema.

alter table public.object_access_events
  drop constraint if exists object_access_events_result_check;

alter table public.object_access_events
  add constraint object_access_events_result_check
  check (result in ('served', 'refused', 'failed', 'aborted'));

comment on column public.object_access_events.result is
  'served: bytes reached the caller. aborted: the caller cancelled mid-transfer, bytes records how much moved. refused: an authorization or policy no. failed: our side broke, not a security event.';
