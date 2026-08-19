"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "@/components/agents/code-block";
import type { AgentCodeLanguage } from "@/components/agents/agent-code";
import { cn } from "@/lib/utils";

/** Languages the shared shiki highlighter bundles; everything else is plain. */
const CODE_LANGUAGES: readonly AgentCodeLanguage[] = [
  "bash",
  "diff",
  "json",
  "tsx",
  "typescript",
];

function codeLanguage(className: string | undefined): AgentCodeLanguage {
  const match = /language-([\w-]+)/.exec(className ?? "");
  const lang = match?.[1];
  if (lang === "ts") return "typescript";
  if (lang === "sh" || lang === "shell" || lang === "zsh") return "bash";
  return CODE_LANGUAGES.find((known) => known === lang) ?? "text";
}

/**
 * Renders assistant markdown (bold, italic, links, lists, headings, code,
 * tables) inside a chat bubble. Shared by the Widget, the admin Preview and
 * the Inbox transcript so every surface reads a reply the same way.
 * Links always open in a new tab: the widget lives in an iframe.
 */
export function ChatMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2 [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2 hover:opacity-80"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          h1: ({ children }) => (
            <h1 className="text-lg leading-snug font-bold">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base leading-snug font-bold">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[15px] leading-snug font-semibold">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm leading-snug font-semibold">{children}</h4>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-current/20 pl-3 opacity-90">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-current/15" />,
          code: ({ children, className: codeClassName }) => {
            // react-markdown marks fenced blocks with a language- class; bare
            // inline code has none. Fenced blocks render through the beui
            // CodeBlock (shiki highlighting, line numbers, copy feedback).
            const block = /language-/.test(codeClassName ?? "");
            return block ? (
              <CodeBlock
                code={String(children).replace(/\n$/, "")}
                language={codeLanguage(codeClassName)}
                showLineNumbers={false}
                className="my-1 text-xs"
              />
            ) : (
              <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.85em]">
                {children}
              </code>
            );
          },
          // Fenced blocks already carry their own surface via CodeBlock; the
          // wrapping <pre> must not add a second box around it.
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-current/20 px-2 py-1.5 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-current/10 px-2 py-1.5 align-top">
              {children}
            </td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
