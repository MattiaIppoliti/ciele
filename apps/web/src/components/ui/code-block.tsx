"use client";

import * as React from "react";
import { Button, CopyFeedbackIcon, useCopyFeedback } from "@agent-hub/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentCodeLine, agentCodeLanguage, useAgentCodeTokens } from "@/components/agents/agent-code";
import { cn } from "@/lib/utils";

/**
 * A copyable code surface, optionally split across tabs, the mono treatment of
 * cult-ui's CodeBlock (cult-ui.com/docs/components/code-block), and the same
 * public shape: pass either `code` + `language`, or a `tabs` array.
 *
 * This is a local implementation rather than the upstream component, for the
 * same reason as `components/motion/grid-beam.tsx`: cult-ui's registry sits
 * behind a bot checkpoint that answers 429 to both fetch and the shadcn CLI, so
 * the source could not be installed. The tab strip is the repo's shared motion
 * `Tabs` rather than a bespoke one, and colouring comes from the same shiki
 * tokens the agent code surfaces use (`agents/agent-code.tsx`), so a `tsx`
 * block here and in chat read identically. A label shiki has no grammar for
 * (`prompt`) renders as plain text and never loads the highlighter.
 */
export interface CodeBlockTab {
  label: string;
  code: string;
  language?: string;
}

export interface CodeBlockProps {
  /** Single-block form. Ignored when `tabs` is given. */
  code?: string;
  language?: string;
  tabs?: CodeBlockTab[];
  className?: string;
}

function CodeSurface({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const tokens = useAgentCodeTokens(code, agentCodeLanguage(language));
  const lines = code.split("\n");
  return (
    // Wraps rather than scrolls sideways: these are commands to copy, and a
    // horizontal scrollbar under a four-line snippet is more chrome than the
    // snippet. `no-scrollbar` keeps the vertical overflow silent too.
    <pre
      data-language={language}
      className="no-scrollbar max-h-[22rem] overflow-y-auto px-4 py-3.5 font-mono text-[0.8125rem] leading-relaxed break-words whitespace-pre-wrap"
    >
      <code className="text-foreground">
        {tokens
          ? lines.map((line, index) => (
              <React.Fragment key={index}>
                <AgentCodeLine code={line} tokens={tokens[index]} />
                {index < lines.length - 1 ? "\n" : null}
              </React.Fragment>
            ))
          : code}
      </code>
    </pre>
  );
}

function CopyCodeButton({
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? "Code copied" : "Copy code"}
      onClick={onCopy}
      // The code is the thing being read; the control sits quiet beside it.
      className="text-muted-foreground hover:text-foreground shrink-0"
    >
      <CopyFeedbackIcon copied={copied} className="size-4" />
    </Button>
  );
}

export function CodeBlock({ code, language, tabs, className }: CodeBlockProps) {
  const { copyText, isCopied } = useCopyFeedback<string>();
  const [activeLabel, setActiveLabel] = React.useState(tabs?.[0]?.label ?? "");

  const shell = cn(
    "border-border/70 bg-card/60 overflow-hidden rounded-xl border backdrop-blur-sm",
    className
  );
  const bar =
    "border-border/60 flex items-center justify-between gap-2 border-b py-1.5 pr-1.5 pl-2";

  if (tabs && tabs.length > 0) {
    const active = tabs.find((tab) => tab.label === activeLabel) ?? tabs[0];

    return (
      <Tabs
        value={active.label}
        onValueChange={(value) => setActiveLabel(String(value))}
        className={cn(shell, "flex flex-col gap-0")}
      >
        <div className={bar}>
          {/* Scrolls rather than wraps: a wrapped tab strip changes the height
              of the header between tabs and makes the block jump. `overflow-y`
              has to be pinned as well, CSS promotes the other axis to `auto`
              on its own, which puts a stray vertical scrollbar in a 28px-tall
              strip. */}
          <TabsList aria-label="Code example language" className="no-scrollbar min-w-0 overflow-x-auto overflow-y-hidden">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.label}
                value={tab.label}
                className="font-mono text-xs"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <CopyCodeButton
            copied={isCopied(active.code)}
            onCopy={() => void copyText(active.code, active.code)}
          />
        </div>
        {tabs.map((tab) => (
          <TabsContent key={tab.label} value={tab.label} className="mt-0">
            <CodeSurface code={tab.code} language={tab.language} />
          </TabsContent>
        ))}
      </Tabs>
    );
  }

  const single = code ?? "";

  return (
    <div className={shell}>
      <div className={bar}>
        <span className="text-muted-foreground truncate px-1.5 font-mono text-xs">
          {language ?? "code"}
        </span>
        <CopyCodeButton
          copied={isCopied(single)}
          onCopy={() => void copyText(single, single)}
        />
      </div>
      <CodeSurface code={single} language={language} />
    </div>
  );
}
