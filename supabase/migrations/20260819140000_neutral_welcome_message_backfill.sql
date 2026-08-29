-- Backfill: replace the education-specific default Welcome Message with the
-- vertical-neutral copy now in `DEFAULT_WELCOME_MESSAGE`
-- (packages/core/src/defaults.ts). Every Assistant created before this change
-- was stamped with the academic string by `createAssistant`, so the constant
-- alone only fixes Assistants created from here on.
--
-- Matched on the exact old text, ignoring surrounding whitespace (one-argument
-- btrim strips spaces only, so the character set is spelled out here), so an
-- Assistant whose Welcome Message a Member actually wrote is never touched, including one
-- that happens to be education-specific on purpose. Idempotent: after the
-- first run nothing matches.
--
-- `updated_at` is deliberately left alone. This is a platform-side copy
-- correction, not a Member edit, and the column has no trigger. Bumping it
-- would report every untouched Assistant as freshly edited in the dashboard.
update public.assistants
set welcome_message =
  'Hi! I can help you find information, answer questions, and point you to the right resources. What would you like to know?'
where btrim(welcome_message, E' \t\r\n') =
  'I can help you with academic information: study plans, academic deadlines, class materials. Tell me: what information would you like to know?';

-- Published Widgets are served from the immutable Publication snapshot
-- (`publications.config -> assistant -> welcomeMessage`, 0006_publish), which
-- this migration does NOT rewrite: a Publication is frozen by contract, and
-- rewriting one would retroactively change what an Organization published.
-- Live Widgets pick the new copy up on their next publish.
