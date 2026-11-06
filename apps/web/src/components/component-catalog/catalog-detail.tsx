"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, ArrowRight, ChevronRight, RotateCcw, Smartphone, Monitor } from "lucide-react";
import { z } from "zod";
import { Button, CopyFeedbackIcon, useCopyFeedback } from "@agent-hub/ui";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CodeBlock } from "@/components/ui/code-block";
import { COMPONENT_FAMILIES, componentFamily, catalogPath } from "./catalog";
import { CatalogLoading } from "./catalog-loading";

const PrimitivePreview = dynamic(() => import("./primitive-previews"), { loading: () => <CatalogLoading />, ssr: false });
const PlatformPreview = dynamic(() => import("./platform-previews"), { loading: () => <CatalogLoading />, ssr: false });
const BlockPreview = dynamic(() => import("./block-previews"), { loading: () => <CatalogLoading />, ssr: false });
const sourceSchema = z.object({ files: z.array(z.object({ path: z.string(), code: z.string() })) });
type SourceState = { kind: "idle" } | { kind: "loading" } | { kind: "error" } | { kind: "ready"; files: z.infer<typeof sourceSchema>["files"] };

function requireFamily(slug: string) {
  const family = componentFamily(slug);
  if (!family) throw new Error(`Unknown catalog entry: ${slug}`);
  return family;
}

export function CatalogDetail({ slug }: { slug: string }) {
  const family = requireFamily(slug);
  const [view, setView] = useState("preview");
  const [replay, setReplay] = useState(0);
  const [compact, setCompact] = useState(false);
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState<SourceState>({ kind: "idle" });
  const [copyError, setCopyError] = useState(false);
  const filesReady = source.kind === "ready";
  const { copyText, isCopied } = useCopyFeedback<string>();
  const entries = COMPONENT_FAMILIES.filter((entry) => entry.kind === family.kind);
  const isBlock = family.kind === "block";
  const position = entries.findIndex((entry) => entry.slug === family.slug);
  const previous = entries[position - 1];
  const next = entries[position + 1];

  useEffect(() => {
    if (view !== "code" || filesReady) return;
    const controller = new AbortController();
    fetch(`/components/${family.slug}/source`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Source unavailable");
        const body: unknown = await response.json();
        const result = sourceSchema.parse(body);
        if (!controller.signal.aborted) setSource({ kind: "ready", files: result.files });
      })
      .catch(() => { if (!controller.signal.aborted) setSource({ kind: "error" }); });
    return () => controller.abort();
  }, [view, family.slug, retry, filesReady]);

  async function copyPage() {
    const markdown = `# ${family.title}\n\n${family.description}\n\n## Variants\n\n${family.variants.map((variant) => `- ${variant}`).join("\n")}\n\n## Usage\n\n\`\`\`tsx\n${family.usage}\n\`\`\`\n\n## Source files\n\n${family.sources.map((path) => `- ${path}`).join("\n")}\n\nhttps://ciele.app${catalogPath(family)}`;
    setCopyError(!await copyText("page", markdown));
  }

  return (
    <article data-catalog-kind={family.kind}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-display">{family.title}</h1>
        <Button variant="ghost" size="sm" onClick={() => void copyPage()}><CopyFeedbackIcon copied={isCopied("page")} />{isCopied("page") ? "Copied" : "Copy page"}</Button>
      </div>
      {copyError && <p role="status" className="mt-2 text-xs text-destructive">Could not copy. Select and copy the text instead.</p>}
      <p className="mt-4 max-w-[65ch] text-lg leading-relaxed text-foreground/85">{family.description}</p>
      <Tabs value={view} onValueChange={(value) => setView(String(value))} className="mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label={`${family.title} documentation`} wrapperClassName="w-fit max-w-[calc(100%-2.5rem)]" className="rounded-full p-1">
            <TabsTrigger value="preview" className="rounded-full px-3 sm:px-5">Preview</TabsTrigger>
            <TabsTrigger value="usage" className="rounded-full px-3 sm:px-5">Usage</TabsTrigger>
            <TabsTrigger value="code" className="rounded-full px-3 sm:px-5">Code</TabsTrigger>
          </TabsList>
          {view === "preview" && <div className="flex items-center gap-1" role="group" aria-label="Preview width"><Button variant="ghost" size="icon-sm" className={!compact ? "bg-alpha-medium" : undefined} aria-label="Fit preview" aria-pressed={!compact} onClick={() => setCompact(false)}><Monitor className="size-3.5" /></Button><Button variant="ghost" size="icon-sm" className={compact ? "bg-alpha-medium" : undefined} aria-label="Compact preview" aria-pressed={compact} onClick={() => setCompact(true)}><Smartphone className="size-3.5" /></Button><Button variant="ghost" size="icon-sm" aria-label="Restart preview" onClick={() => setReplay(replay + 1)}><RotateCcw className="size-3.5" /></Button></div>}
        </div>
        <TabsContent value="preview">
          <div data-ui data-foley-silent data-testid="component-preview" style={{ maxWidth: compact ? "26rem" : "100%" }} className={`@container relative p-4 sm:p-6 ${isBlock ? "min-h-80 rounded-xl border border-alpha-medium" : "min-h-64 rounded-xl bg-alpha-lighter"}`}>
            {family.preview === "primitive" ? <PrimitivePreview key={replay} slug={family.slug} /> : family.preview === "block" ? <BlockPreview key={replay} slug={family.slug} /> : <PlatformPreview key={replay} slug={family.slug} />}
            {family.companion && <div className="mt-6"><PlatformPreview key={`${replay}-companion`} slug={family.companion} /></div>}
          </div>
          {family.notes && <p className="mt-4 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">{family.notes}</p>}
        </TabsContent>
        <TabsContent value="usage">
          <CodeBlock code={family.usage} language="tsx" />
        </TabsContent>
        <TabsContent value="code">
          <div className="flex flex-col gap-4">
            <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">The implementation used by Ciele, including its supporting components. Original attribution and license notices remain in the files.</p>
            {(source.kind === "idle" || source.kind === "loading") && <p role="status" className="rounded-xl border border-alpha-medium p-8 text-sm text-muted-foreground">Loading source files…</p>}
            {source.kind === "error" && <div role="alert" className="rounded-xl border border-alpha-medium p-6"><p className="mb-3 text-sm">Source files could not be loaded.</p><Button variant="outline" onClick={() => { setSource({ kind: "loading" }); setRetry(retry + 1); }}>Try again</Button></div>}
            {source.kind === "ready" && <div className="flex flex-col gap-2">{source.files.map((file, index) => <SourceFile key={file.path} path={file.path} code={file.code} defaultOpen={index === 0} />)}</div>}
          </div>
        </TabsContent>
      </Tabs>
      <nav aria-label="Pagination" className="mt-16 grid grid-cols-2 gap-3">
        {previous ? <PagerLink entry={previous} direction="previous" /> : <span />}
        {next && <PagerLink entry={next} direction="next" />}
      </nav>
    </article>
  );
}

function SourceFile({ path, code, defaultOpen }: { path: string; code: string; defaultOpen: boolean }) {
  const slash = path.lastIndexOf("/") + 1;
  return (
    <details open={defaultOpen} className="group rounded-xl border border-alpha-medium">
      <summary className="press-text flex cursor-pointer list-none items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none" />
        <span className="min-w-0 break-all"><span className="text-muted-foreground">{path.slice(0, slash)}</span>{path.slice(slash)}</span>
      </summary>
      <div className="px-1.5 pb-1.5"><CodeBlock code={code} language={path.endsWith(".css") ? "css" : "tsx"} className="rounded-lg" /></div>
    </details>
  );
}

function PagerLink({ entry, direction }: { entry: (typeof COMPONENT_FAMILIES)[number]; direction: "previous" | "next" }) {
  const isNext = direction === "next";
  const Arrow = isNext ? ArrowRight : ArrowLeft;
  return (
    <Link href={catalogPath(entry)} className={`group flex items-center gap-3 rounded-xl bg-alpha-light px-4 py-3.5 text-base transition-[background-color,transform] duration-150 ease-out hover:bg-alpha-medium active:scale-[0.98] motion-reduce:transition-none ${isNext ? "col-start-2 flex-row-reverse text-right" : ""}`}>
      <Arrow aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out motion-reduce:transition-none ${isNext ? "group-hover:translate-x-0.5" : "group-hover:-translate-x-0.5"}`} />
      <span className="min-w-0"><span className="block text-sm text-muted-foreground">{isNext ? "Next" : "Previous"}</span><span className="block truncate font-medium">{entry.title}</span></span>
    </Link>
  );
}
