/**
 * Where this deployment's docs point for source and for the product itself.
 *
 * `DOCS_REPO_URL` has **no baked-in default**: a repository slug belongs to
 * whoever deploys these docs, not to the code, so hardcoding one would ship a
 * specific owner's slug into every fork and into the public mirror, which the
 * `personal-github-slug` deny token in `scripts/mirror-gate` fails the release
 * on. Set `NEXT_PUBLIC_DOCS_REPO_URL` to this deployment's repository and the
 * sidebar GitHub button plus the per-page "Edit this page" action appear; leave
 * it unset and both are omitted rather than pointing somewhere wrong.
 */
export const DOCS_REPO_URL = process.env.NEXT_PUBLIC_DOCS_REPO_URL;

/** The marketing site the docs' home button returns to. */
export const SITE_URL =
  process.env.NEXT_PUBLIC_CIELE_SITE_URL || 'https://ciele.app';
