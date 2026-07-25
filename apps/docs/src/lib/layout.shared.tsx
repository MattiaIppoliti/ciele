import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { GhostMark } from '@/components/ghost-mark';

/**
 * Shared layout options for Ciele documentation (ciele.app/docs).
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-medium">
          <GhostMark className="size-6" />
          <span className="text-lg leading-none">Ciele</span>
        </span>
      ),
    },
    // GitHub link in the sidebar footer (next to the theme toggle). Env-driven
    // so each deployment (source repo, public mirror) points at its own repo
    // slug; when the env is unset the link is simply hidden — same rule as the
    // "Edit this page" base in the docs page route.
    githubUrl: process.env.NEXT_PUBLIC_DOCS_REPO_URL || undefined,
  };
}
