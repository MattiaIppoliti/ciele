-- SSO identity threading (spec ciele-org#660, ticket ciele-org#662).
--
-- Conversations started by an end-user who authenticated through the widget's
-- SSO gate carry their own subject type: the verified OIDC subject stops being
-- discarded after the gate check and becomes the conversation's subject.
-- 'visitor' (anonymous, client-generated id) and 'member' (admin preview) are
-- unchanged. Widget traffic is served by API routes over the service role, so
-- no policy change is needed — only the check constraint widens.
--
-- The opt-in identity claim lives in sso_connections.config (jsonb) and needs
-- no schema change.

alter table public.conversations
  drop constraint conversations_subject_type_check;

alter table public.conversations
  add constraint conversations_subject_type_check
  check (subject_type in ('member', 'visitor', 'sso'));
