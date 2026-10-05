"use client";
// beui.dev/components/agents/code-block

import { Check, FileCode2 } from "lucide-react";
// Icon data for the copy mark, which reshapes into the check on click.
import { Check as CheckData, Copy as CopyData } from "lucide";
import { MorphIcon } from "morphicons/react";
import { Button } from "@agent-hub/ui";
import {
  type AgentCodeLanguage,
  AgentCodeLine,
  useAgentCodeTokens,
} from "@/components/agents/agent-code";
import { useCopied } from "@/lib/hooks/use-copied";
import { cn } from "@/lib/utils";

// Trimmed from upstream to what the chat markdown renders: a complete
// (never streaming) block, no filename, no line numbers, always copyable.
export function CodeBlock({
  code,
  language = "typescript",
  className,
}: {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}) {
  const [copied, markCopied] = useCopied();
  const tokens = useAgentCodeTokens(code, language);
  const lines: Array<{ content: string; offset: number }> = [];
  let offset = 0;
  for (const content of code.split("\n")) {
    lines.push({ content, offset });
    offset += content.length + 1;
  }

  const handleCopy = async () => {
    await navigator.clipboard?.writeText(code);
    markCopied();
  };

  return (
    <div
      data-state="complete"
      aria-busy={false}
      className={cn(
        "w-full overflow-hidden rounded-2xl bg-muted/80 text-sm",
        className,
      )}
    >
      <div className="flex h-10 items-center gap-2.5 px-3">
        <FileCode2
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground/70"
        />
        <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground/55">
          {language}
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="size-3" />
          Ready
        </span>
        <Button
          type="button"
          aria-label={copied ? "Copied" : "Copy code"}
          title={copied ? "Copied" : "Copy code"}
          onClick={handleCopy}
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <MorphIcon icon={copied ? CheckData : CopyData} size={14} />
        </Button>
      </div>

      <div
        className="scrollbar-hide overflow-auto border-t border-foreground/[0.06] py-2"
        style={{ maxHeight: 280 }}
      >
        <pre className="m-0 min-w-max font-mono text-xs leading-5 text-foreground/85">
          <code>
            {lines.map((line, index) => (
              <span key={line.offset} className="grid min-h-5 grid-cols-1">
                <AgentCodeLine
                  code={line.content}
                  tokens={tokens?.[index]}
                  className="pr-4 pl-4 whitespace-pre"
                />
              </span>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
