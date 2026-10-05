"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, ArrowRight, ChevronRight, RotateCcw, Smartphone, Monitor } from "lucide-react";
import { z } from "zod";
import { Badge, Button, CopyFeedbackIcon, useCopyFeedback } from "@agent-hub/ui";
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
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground"><Link href={isBlock ? "/components/blocks" : "/components"} className="press-text hover:text-foreground">{isBlock ? "Blocks" : "Components"}</Link><ChevronRight className="size-3.5" aria-hidden="true" /><span className="text-foreground">{family.title}</span></div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="mb-2 text-xs text-muted-foreground">{family.group}</p><h1 className="text-3xl font-semibold tracking-tight">{family.title}</h1></div>
        <Button variant="secondary" size="sm" onClick={() => void copyPage()}><CopyFeedbackIcon copied={isCopied("page")} />{isCopied("page") ? "Copied" : "Copy page"}</Button>
      </div>
      {copyError && <p role="status" className="mt-2 text-xs text-destructive">Could not copy. Select and copy the text instead.</p>}
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{family.description}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">{family.variants.map((variant) => <Badge key={variant} variant="secondary">{variant}</Badge>)}</div>
      <Tabs value={view} onValueChange={(value) => setView(String(value))} className="mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label={`${family.title} documentation`} wrapperClassName="w-fit max-w-[calc(100%-2.5rem)]" className="rounded-full p-1">
            <TabsTrigger value="preview" className="rounded-full px-3 sm:px-5">Preview</TabsTrigger>
            <TabsTrigger value="usage" className="rounded-full px-3 sm:px-5">Usage</TabsTrigger>
            <TabsTrigger value="code" className="rounded-full px-3 sm:px-5">Code</TabsTrigger>
          </TabsList>
          {view === "preview" && <div className="flex items-center gap-1" role="group" aria-label="Preview width"><Button variant={!compact ? "secondary" : "ghost"} size="icon-sm" aria-label="Fit preview" aria-pressed={!compact} onClick={() => setCompact(false)}><Monitor className="size-3.5" /></Button><Button variant={compact ? "secondary" : "ghost"} size="icon-sm" aria-label="Compact preview" aria-pressed={compact} onClick={() => setCompact(true)}><Smartphone className="size-3.5" /></Button><Button variant="ghost" size="icon-sm" aria-label="Restart preview" onClick={() => setReplay(replay + 1)}><RotateCcw className="size-3.5" /></Button></div>}
        </div>
        <TabsContent value="preview">
          <div data-foley-silent data-testid="component-preview" style={{ maxWidth: compact ? "26rem" : "100%" }} className={`@container relative p-4 sm:p-6 ${isBlock ? "min-h-80 rounded-xl border border-alpha-medium" : "min-h-64 rounded-xl bg-alpha-lighter"}`}>
            {family.preview === "primitive" ? <PrimitivePreview key={replay} slug={family.slug} /> : family.preview === "block" ? <BlockPreview key={replay} slug={family.slug} /> : <PlatformPreview key={replay} slug={family.slug} />}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Live components with example content. Try their controls, or switch the theme and palette.</p>
          {family.notes && <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">{family.notes}</p>}
        </TabsContent>
        <TabsContent value="usage" className="space-y-6">
          <div><h2 className="mb-3 text-lg font-semibold">Usage</h2><CodeBlock code={family.usage} language="tsx" /></div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div><h3 className="mb-3 text-sm font-medium">Included variants</h3><ul className="space-y-2 text-sm text-muted-foreground">{family.variants.map((variant) => <li key={variant}>{variant}</li>)}</ul></div>
            <div><h3 className="mb-3 text-sm font-medium">In Ciele</h3><p className="text-sm leading-relaxed text-muted-foreground">Use the workspace imports shown above inside Ciele. App components use the shared Tailwind tokens in <code className="text-xs">globals.css</code>. For another project, adapt the imports and bring the dependencies listed in the source.</p>{family.notes && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{family.notes}</p>}</div>
          </div>
          <div><h3 className="mb-3 text-sm font-medium">Source files</h3><ul className="space-y-2 text-xs text-muted-foreground">{family.sources.map((path) => <li className="break-all font-mono" key={path}>{path}</li>)}</ul></div>
        </TabsContent>
        <TabsContent value="code" className="space-y-4">
          <div><h2 className="text-lg font-semibold">Source code</h2><p className="mt-2 text-sm text-muted-foreground">The implementation used by Ciele, including its supporting components. Original attribution and license notices remain in the files.</p></div>
          {(source.kind === "idle" || source.kind === "loading") && <p role="status" className="rounded-xl border border-alpha-medium p-8 text-sm text-muted-foreground">Loading source files…</p>}
          {source.kind === "error" && <div role="alert" className="rounded-xl border border-alpha-medium p-6"><p className="mb-3 text-sm">Source files could not be loaded.</p><Button variant="outline" onClick={() => { setSource({ kind: "loading" }); setRetry(retry + 1); }}>Try again</Button></div>}
          {source.kind === "ready" && source.files.map((file, index) => <details key={file.path} open={index === 0} className="rounded-xl border border-alpha-medium p-3"><summary className="press-text cursor-pointer break-all px-1 py-2 font-mono text-xs">{file.path}</summary><CodeBlock code={file.code} language={file.path.endsWith(".css") ? "css" : "tsx"} /></details>)}
        </TabsContent>
      </Tabs>
      <div className="mt-12 grid grid-cols-2 gap-6 border-t border-alpha-medium pt-6">
        <div>{previous && <Link href={catalogPath(previous)} className="press-text inline-flex items-center gap-3 text-sm"><ArrowLeft className="size-4 text-muted-foreground" /><span><span className="mb-1 block text-2xs text-muted-foreground">Previous</span>{previous.title}</span></Link>}</div>
        <div className="text-right">{next && <Link href={catalogPath(next)} className="press-text inline-flex items-center gap-3 text-sm"><span><span className="mb-1 block text-2xs text-muted-foreground">Next</span>{next.title}</span><ArrowRight className="size-4 text-muted-foreground" /></Link>}</div>
      </div>
    </article>
  );
}
