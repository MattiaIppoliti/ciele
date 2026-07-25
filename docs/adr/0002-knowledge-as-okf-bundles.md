# Knowledge Collections are stored as OKF bundles

Each Knowledge Collection inside an Assistant is represented as an Open Knowledge Format (OKF v0.1) bundle: a directory of markdown Concept documents with YAML frontmatter (`type` required; `title`, `description`, `resource`, `tags`, `timestamp`), cross-linked with normal markdown links, with `index.md` for progressive disclosure. Uploaded Sources (PDFs, URLs) are ingested by an enrichment step that drafts one Concept per meaningful unit; embeddings for RAG (pgvector) index Concept content and always point back to their Concept, so chat citations resolve to a Concept and its original Source.

Why: OKF makes the knowledge portable (export/import a collection as a tarball, versionable in git, readable by humans and by any agent) instead of locking it into an opaque blob+embeddings pipeline, and its `index.md` progressive-disclosure convention matches how the agent loop navigates knowledge. Google published OKF as an open, vendor-neutral spec in June 2026.

**Rejected:** storing only raw files + embedding chunks (simplest, but knowledge is not portable, not human-curatable, and citations can only point at page offsets instead of curated Concepts).
