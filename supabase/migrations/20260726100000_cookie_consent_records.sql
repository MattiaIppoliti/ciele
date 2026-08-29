-- Server-side proof of cookie consent (GDPR Art. 7(1): the controller must be
-- able to demonstrate that consent was given).
--
-- Until now the only evidence of a visitor's choice was the `cc_cookie` on the
-- visitor's own device. That is evidence they hold and can erase, not evidence
-- we hold, so it cannot discharge our accountability obligation. This table is
-- our copy of the event: what was chosen, against which version of the
-- declaration, and when.
--
-- `consent_id` is the join back to the visitor: the consent plugin writes the
-- same random id into their cookie, so a row here and the cookie on the device
-- corroborate each other. That id is the whole identification mechanism, which
-- is why we deliberately do NOT store an IP address, see the column notes.
--
-- Unlike every other table in this schema, consent records are not org-scoped:
-- they are written by anonymous visitors to our own marketing site, who have no
-- organization. So RLS here is not "members of the owning org" but "nobody",
-- see the policy note at the bottom.

create table public.cookie_consent_records (
  id uuid primary key,

  -- The plugin's consent id, mirrored in the visitor's `cc_cookie`. Not a
  -- Ciele account id and not stable across a cookie clear, by design.
  consent_id text not null,

  -- Which revision of the cookie declaration the visitor was shown. Consent to
  -- revision 1 does not evidence consent to revision 2, so a record without
  -- this proves very little.
  revision integer not null,

  -- The choice itself. Kept as the accepted/rejected split rather than a single
  -- list so a record stays readable even after the declaration adds categories.
  accepted_categories text[] not null default '{}',
  rejected_categories text[] not null default '{}',

  -- 'all' | 'custom' | 'necessary', the shape of the choice, which is what
  -- shows at a glance whether rejection was as reachable as acceptance.
  accept_type text not null,

  -- 'granted' for a first decision, 'changed' for a later edit or withdrawal.
  -- Withdrawals are recorded, never overwritten: the history is the evidence.
  action text not null,

  -- Visitor's clock when they chose; `created_at` is ours when we stored it.
  -- Both are kept because a mismatch is itself a signal, and only ours is trusted.
  consented_at timestamptz,

  -- Context, capped at the API boundary. Deliberately minimal: no IP address,
  -- because `consent_id` already links the record to the device and an IP would
  -- add identifying data this table does not need (Art. 5(1)(c) minimisation).
  page_url text not null default '',
  user_agent text not null default '',

  created_at timestamptz not null default now()
);

-- Lookup by consent id is the access pattern that matters: "show me what this
-- visitor agreed to", answering a subject request or a regulator's question.
create index if not exists cookie_consent_records_consent_id_idx
  on public.cookie_consent_records (consent_id, created_at desc);

create index if not exists cookie_consent_records_created_at_idx
  on public.cookie_consent_records (created_at desc);

alter table public.cookie_consent_records enable row level security;

-- No policies, on purpose. RLS is enabled and nothing is granted, so neither
-- `anon` nor `authenticated` can read or write this table: an audit log that a
-- visitor could rewrite would be worthless as evidence, and one they could read
-- would leak other visitors' records. Writes come from the service-role client
-- in apps/web/src/app/api/cookie-consent, which bypasses RLS; reads are for
-- operators via the service role. Do not add a permissive policy here without
-- re-reading that reasoning.
