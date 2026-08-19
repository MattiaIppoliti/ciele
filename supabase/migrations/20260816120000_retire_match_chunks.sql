-- Knowledge hub contract, step 1 (PRD #726, ticket #733).
--
-- match_chunks_linked has been the only retrieval path since the expand
-- shipped (its dual predicate keeps legacy source-less chunks reachable by
-- their assistant), so the pre-link RPC is dead code, retire it. The
-- assistant_id column drops are a later contract step: crawler claim queries,
-- chunk RLS, and the ingestion stamp still read them.

drop function if exists public.match_chunks(text, text, vector, int);
