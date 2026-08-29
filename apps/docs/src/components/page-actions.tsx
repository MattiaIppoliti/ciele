'use client';

import { useEffect, useRef, useState } from 'react';
import { CopyFeedbackIcon, useCopyFeedback } from '@agent-hub/ui';
import {
  ChevronDown,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { GitHubIcon } from '@/components/github-icon';

function OpenAiIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

function AnthropicIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
    </svg>
  );
}

/**
 * Page actions for AI workflows: copy the page as Markdown, and an "Open" menu
 * to view the raw Markdown, open the source on GitHub, or hand the page to an AI
 * tool (ChatGPT or Claude). The Markdown comes from the *.md
 * endpoint (see next.config.mjs + app/llms.mdx). AI tools receive an absolute
 * URL to that Markdown so they can fetch and reason about the page.
 */
export function PageActions({
  markdownUrl,
  githubUrl,
}: {
  markdownUrl: string;
  githubUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isCopied, runCopy } = useCopyFeedback<string>();
  const copied = isCopied(markdownUrl);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function copyMarkdown() {
    await runCopy(markdownUrl, async () => {
      const res = await fetch(markdownUrl);
      if (!res.ok) throw new Error(`Could not load Markdown (${res.status})`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
    });
  }

  // Open an AI tool with a prompt pointing at this page's absolute Markdown URL.
  // Resolved at click time (client-only) to avoid reading window during render.
  function openInAiTool(base: string) {
    const absoluteMd = `${window.location.origin}${markdownUrl}`;
    const prompt = `Read ${absoluteMd} so I can ask you questions about this page.`;
    window.open(`${base}${encodeURIComponent(prompt)}`, '_blank', 'noopener');
    setOpen(false);
  }

  const aiTargets = [
    {
      label: 'Open in ChatGPT',
      base: 'https://chatgpt.com/?hints=search&q=',
      Icon: OpenAiIcon,
    },
    {
      label: 'Open in Claude',
      base: 'https://claude.ai/new?q=',
      Icon: AnthropicIcon,
    },
  ];

  const buttonClass =
    // `whitespace-nowrap` keeps the icon beside its label on one line; the row
    // itself is allowed to wrap, but a button never should.
    'inline-flex flex-nowrap items-center gap-1.5 whitespace-nowrap rounded-lg border border-fd-border px-2.5 py-1.5 text-xs font-medium text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground';
  const menuItemClass =
    'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs text-fd-popover-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground';

  return (
    <div className="mb-6 flex flex-row flex-wrap items-center gap-2 border-b border-fd-border pb-4">
      <button type="button" onClick={copyMarkdown} className={buttonClass}>
        <CopyFeedbackIcon copied={copied} className="size-3.5" />
        {/* Label stays put, the icon flipping to a check is the confirmation.
            Swapping in a shorter "Copied" resized the button and shunted the
            rest of the row sideways. */}
        Copy Markdown
      </button>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={buttonClass}
        >
          Open
          <ChevronDown className="size-3.5" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute left-0 top-full z-50 mt-1.5 w-56 rounded-xl border border-fd-border bg-fd-popover p-1 shadow-lg"
          >
            {githubUrl && (
              <a
                role="menuitem"
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className={menuItemClass}
                onClick={() => setOpen(false)}
              >
                <span className="inline-flex items-center gap-2">
                  <GitHubIcon className="size-3.5" />
                  Open in GitHub
                </span>
                <ExternalLink className="size-3 opacity-60" />
              </a>
            )}
            <a
              role="menuitem"
              href={markdownUrl}
              target="_blank"
              rel="noreferrer"
              className={menuItemClass}
              onClick={() => setOpen(false)}
            >
              <span className="inline-flex items-center gap-2">
                <FileText className="size-3.5" />
                View as Markdown
              </span>
              <ExternalLink className="size-3 opacity-60" />
            </a>

            <div className="my-1 h-px bg-fd-border" />

            {aiTargets.map(({ label, base, Icon }) => (
              <button
                key={label}
                type="button"
                role="menuitem"
                onClick={() => openInAiTool(base)}
                className={menuItemClass}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon className="size-3.5" />
                  {label}
                </span>
                <ExternalLink className="size-3 opacity-60" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
