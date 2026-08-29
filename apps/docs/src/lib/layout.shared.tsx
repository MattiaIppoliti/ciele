import type { BaseLayoutProps, LinkItemType } from 'fumadocs-ui/layouts/shared';
import { House } from 'lucide-react';
import { GhostMark } from '@/components/ghost-mark';
import { GitHubIcon } from '@/components/github-icon';
import { DOCS_REPO_URL, SITE_URL } from '@/lib/repo';

/**
 * `aria-label`s of the two footer buttons. They are also the CSS hooks for the
 * rules in global.css that draw the divider after the repository button and size
 * both glyphs, keep the two in step.
 */
export const HOME_BUTTON_LABEL = 'Back to ciele.app';
export const REPO_BUTTON_LABEL = 'Ciele on GitHub';

/**
 * Shared layout options for Ciele documentation (ciele.app/docs).
 */
export function baseOptions(): BaseLayoutProps {
  // Icon links render as a row in the sidebar footer, with the theme toggle
  // pushed to its far end (fumadocs' docs sidebar reserves that row for
  // `type: 'icon'` items). Home first, then the repo: leaving the docs is the
  // more common intent of the two. The repository button is declared here
  // rather than through the `githubUrl` shortcut so this app owns its label,
  // which is what global.css hangs the trailing divider on.
  const links: LinkItemType[] = [
    {
      type: 'icon',
      icon: <House />,
      text: 'Ciele',
      label: HOME_BUTTON_LABEL,
      url: SITE_URL,
      external: true,
    },
  ];

  // Only when this deployment declares its repository (see lib/repo.ts), there
  // is no default slug to fall back on. Without it the row is just the home
  // button, and global.css's divider rule simply matches nothing.
  if (DOCS_REPO_URL) {
    links.push({
      type: 'icon',
      icon: <GitHubIcon />,
      text: 'GitHub',
      label: REPO_BUTTON_LABEL,
      url: DOCS_REPO_URL,
      external: true,
    });
  }

  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-medium">
          <GhostMark className="size-6" />
          <span className="text-lg leading-none">Ciele</span>
        </span>
      ),
    },
    links,
  };
}
