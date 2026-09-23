"use client";

import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, CopyFeedbackIcon, useCopyFeedback } from "@agent-hub/ui";
import { getDocumentBodyAction } from "@/app/actions";
import { toast } from "@/lib/toast";

/**
 * A Document's OKF body, rendered (#928).
 *
 * `react-markdown` **without** `rehype-raw`, which is the sanitisation: raw
 * HTML in a crawled page is inert text, never nodes. Everything the format
 * actually uses survives, headings, lists, GFM task lists and tables, block
 * quotes, images and links, and a fenced block (the reference's corpus is full
 * of Dataview queries) renders verbatim as code rather than being interpreted.
 *
 * The route ships the head only (`contentHead`): a long body reaches the
 * client when the reader asks for it, through the same operation that read
 * the row, so a million-character page costs nothing until "Show all".
 */
export function DocumentContent({
  head,
  total,
  sourceId,
  documentId,
  assistantId,
}: {
  /** The body before the fold, or all of it when it fits. */
  head: string;
  /** The whole body's length; equal to `head.length` when nothing is folded. */
  total: number;
  sourceId: string;
  documentId: string;
  assistantId?: string;
}) {
  const [full, setFull] = useState<string | null>(total === head.length ? head : null);
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { copyText, isCopied } = useCopyFeedback<string>();
  const copied = isCopied(documentId);

  const loadFull = async (): Promise<string | null> => {
    if (full !== null) return full;
    try {
      const body = await getDocumentBodyAction({ sourceId, documentId, assistantId });
      setFull(body);
      return body;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the content");
      return null;
    }
  };

  const folded = total > head.length && !expanded;
  const shown = folded || full === null ? head : full;
  const body = head;

  return (
    <div className="bg-card relative rounded-xl border">
      <div className="absolute top-2 right-2 z-10">
        <Button
          variant="ghost"
          size="icon"
          aria-label={copied ? "Content copied" : "Copy content"}
          onClick={() =>
            startTransition(async () => {
              const text = await loadFull();
              if (text === null) return;
              if (await copyText(documentId, text)) toast.success("Content copied");
              else toast.error("Could not copy the content");
            })
          }
        >
          <CopyFeedbackIcon copied={copied} className="size-4" />
        </Button>
      </div>

      <div
        className={`prose-sm max-w-none space-y-3 px-5 py-4 [overflow-wrap:anywhere] ${
          folded ? "relative max-h-[60vh] overflow-hidden" : ""
        }`}
      >
        {body.trim().length === 0 ? (
          <p className="text-muted-foreground text-sm">
            This Document has no body. It was stored for its title and its
            provenance.
          </p>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => (
                <h1 className="mt-4 text-xl font-semibold first:mt-0">{children}</h1>
              ),
              h2: ({ children }) => (
                <h2 className="mt-4 text-lg font-semibold first:mt-0">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="mt-3 text-base font-semibold first:mt-0">{children}</h3>
              ),
              p: ({ children }) => <p className="text-sm leading-relaxed">{children}</p>,
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  {children}
                </a>
              ),
              ul: ({ children }) => (
                <ul className="list-disc space-y-1 pl-5 text-sm">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal space-y-1 pl-5 text-sm">{children}</ol>
              ),
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              input: ({ checked }) => (
                // GFM task lists. Read-only: this is the Document as stored,
                // not a checklist the reader owns.
                <input
                  type="checkbox"
                  checked={checked ?? false}
                  readOnly
                  className="mr-1.5 size-3.5 align-middle"
                />
              ),
              blockquote: ({ children }) => (
                <blockquote className="text-muted-foreground border-l-2 pl-4 text-sm italic">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border-b px-2 py-1 text-left font-semibold">{children}</th>
              ),
              td: ({ children }) => <td className="border-b px-2 py-1">{children}</td>,
              img: ({ src, alt }) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={typeof src === "string" ? src : undefined}
                  alt={alt ?? ""}
                  className="max-w-full rounded-md border"
                />
              ),
              code: ({ className, children }) =>
                /language-/.test(className ?? "") ? (
                  <code className="block overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs whitespace-pre">
                    {children}
                  </code>
                ) : (
                  <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                    {children}
                  </code>
                ),
              pre: ({ children }) => <pre className="my-2">{children}</pre>,
            }}
          >
            {shown}
          </ReactMarkdown>
        )}
        {folded && (
          <div className="from-background pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent" />
        )}
      </div>

      {total > head.length && (
        <div className="border-t px-5 py-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => {
              if (expanded) {
                setExpanded(false);
                return;
              }
              startTransition(async () => {
                if ((await loadFull()) !== null) setExpanded(true);
              });
            }}
          >
            {expanded
              ? "Show less"
              : isPending
                ? "Loading…"
                : `Show all (${total.toLocaleString()} characters)`}
          </Button>
        </div>
      )}
    </div>
  );
}
