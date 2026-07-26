"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  Concept,
  KnowledgeCollection,
  RecrawlSchedule,
  Source,
  WebsiteCrawlerProvider,
} from "@agent-hub/db";
import { effectivePageSchedule, nextCrawlDue } from "@agent-hub/db";
import { conceptProvenanceView } from "@/lib/okf-provenance";
import {
  Bold,
  ChevronDown,
  CloudUpload,
  Code,
  Download,
  ExternalLink,
  FileUp,
  Globe,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Info,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  RemoveFormatting,
  Search,
  TextQuote,
  Trash2,
  Undo2,
  Unlink,
} from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "sonner";
import {
  addWebsiteSourceAction,
  createFaqAction,
  reembedKnowledgeAction,
  deleteConceptAction,
  deleteSourceAction,
  importFaqsAction,
  pollWebsiteCrawlAction,
  recrawlWebsiteSourceAction,
  reprocessSourceAction,
  retrySourceIngestAction,
  setPageExcludedAction,
  setPageRecrawlScheduleAction,
  setRecrawlScheduleAction,
  updateFaqAction,
  updateWebsiteSourceAction,
  uploadFileSourceAction,
  type WebsiteFormInput,
} from "@/app/actions";
import { FAQ_CSV_MAX_BYTES, serializeFaqCsv } from "@/lib/faq-csv";
import { validateKnowledgeFile } from "@/lib/storage/assets";
import { paginationRange } from "@/lib/pagination";
import { FileUpload, type FileUploadItem } from "@/components/ui/file-upload";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Mode = "websites" | "documents" | "faqs" | "okf";

const MODES: Array<{ id: Mode; label: string }> = [
  { id: "websites", label: "Websites" },
  { id: "documents", label: "Documents" },
  { id: "faqs", label: "FAQs" },
  { id: "okf", label: "OKF" },
];

function StatusBadge({ source }: { source: Source }) {
  if (source.status === "ready")
    return (
      <Badge variant="outline" className="text-muted-foreground gap-1.5 rounded-full bg-muted/40">
        <span className="size-1.5 rounded-full bg-foreground" /> READY
      </Badge>
    );
  if (source.status === "error")
    return (
      <Badge variant="outline" className="rounded-full border-red-300 bg-red-50 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300" title={source.error}>
        ERROR
      </Badge>
    );
  return (
    <Badge variant="outline" className="rounded-full">
      <span className="animate-pulse">Processing…</span>
    </Badge>
  );
}

/** "Never crawled" / "Last …" plus the next scheduled crawl, if any. */
function crawlScheduleHint(source: Source): string {
  const last = source.lastCrawledAt
    ? `Last: ${new Date(source.lastCrawledAt).toLocaleDateString()}`
    : "Never crawled";
  const due = nextCrawlDue(source.recrawlSchedule, source.lastCrawledAt);
  return due ? `${last} · Next: ${new Date(due).toLocaleDateString()}` : last;
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-muted/50 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-primary flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold"
      >
        <ChevronDown className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`} />
        {title}
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

/* ------------------------------ Websites tab ------------------------------ */

function websiteFormDefaults(source?: Source): WebsiteFormInput {
  return {
    name: source?.name ?? "",
    url: source?.config.url ?? "",
    crawlerProvider: source?.config.crawlerProvider ?? "auto",
    maxPages: source?.config.maxPages ?? 20,
    includeGlobs: (source?.config.includeGlobs ?? []).join("\n"),
    excludeGlobs: (source?.config.excludeGlobs ?? []).join("\n"),
    fetchFiles: source?.config.fetchFiles ?? false,
    throttle: source?.config.throttle ?? false,
    pageTimeoutSecs: source?.config.pageTimeoutSecs,
    waitSecs: source?.config.waitSecs,
    loginProtected: source?.config.loginProtected ?? false,
  };
}

function WebsiteConfigFields({
  form,
  setForm,
  crawl4aiAvailable = false,
  apifyAvailable = false,
}: {
  form: WebsiteFormInput;
  setForm: (f: WebsiteFormInput) => void;
  crawl4aiAvailable?: boolean;
  apifyAvailable?: boolean;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label>
          Name of Knowledge source <span className="text-destructive">*</span>
        </Label>
        <p className="text-muted-foreground text-xs">A generic name that can help you remember it.</p>
        <Input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value.slice(0, 100) })}
          placeholder="Enter name of website"
          required
        />
        <p className="text-muted-foreground text-right text-xs">{form.name.length}/100</p>
      </div>

      <div className="space-y-2">
        <Label>
          Knowledge Base URL <span className="text-destructive">*</span>
        </Label>
        <p className="text-muted-foreground text-xs">The URL of the website whose content you want to import.</p>
        <Input
          type="url"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value.slice(0, 300) })}
          placeholder="https://example.com"
          required
        />
        <p className="text-muted-foreground text-right text-xs">{form.url.length}/300</p>
      </div>

      <div className="space-y-2">
        <Label>Web crawler</Label>
        <p className="text-muted-foreground text-xs">
          Automatic picks the crawler each crawl: the built-in crawler for small
          static sites, Crawl4AI for JavaScript-rendered or larger crawls, and
          Apify for file downloads or login-protected sites. You can force a
          specific crawler for the next crawl.
        </p>
        <Select
          value={form.crawlerProvider ?? "auto"}
          onValueChange={(value) =>
            setForm({
              ...form,
              crawlerProvider: value as WebsiteCrawlerProvider,
            })
          }
        >
          <SelectTrigger className="w-full" aria-label="Web crawler">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Automatic</SelectItem>
            <SelectItem value="local">Local</SelectItem>
            <SelectItem value="crawl4ai" disabled={!crawl4aiAvailable}>
              Crawl4AI{crawl4aiAvailable ? "" : " (not configured)"}
            </SelectItem>
            <SelectItem value="apify" disabled={!apifyAvailable}>
              Apify{apifyAvailable ? "" : " (not configured)"}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Configured crawlers: Local
          {crawl4aiAvailable ? ", Crawl4AI" : ""}
          {apifyAvailable ? ", Apify" : ""}.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
        <span className="text-sm font-semibold">Fetch files during updates</span>
        <Switch
          checked={form.fetchFiles ?? false}
          onCheckedChange={(checked) => setForm({ ...form, fetchFiles: checked })}
          aria-label="Fetch files during updates"
        />
      </div>

      <Collapsible title="Advanced settings">
        <div className="space-y-2">
          <Label>Positive Search Filters</Label>
          <p className="text-muted-foreground text-xs">Only crawl URLs matching these globs (one per line).</p>
          <Textarea
            value={form.includeGlobs}
            onChange={(e) => setForm({ ...form, includeGlobs: e.target.value.slice(0, 2000) })}
            placeholder={"https://example.com/docs/**"}
            rows={3}
          />
          <p className="text-muted-foreground text-right text-xs">{(form.includeGlobs ?? "").length}/2000</p>
        </div>
        <div className="space-y-2">
          <Label>Negative Search Filters</Label>
          <p className="text-muted-foreground text-xs">Skip URLs matching these globs (one per line).</p>
          <Textarea
            value={form.excludeGlobs}
            onChange={(e) => setForm({ ...form, excludeGlobs: e.target.value.slice(0, 2000) })}
            placeholder={"https://example.com/blog/**"}
            rows={3}
          />
          <p className="text-muted-foreground text-right text-xs">{(form.excludeGlobs ?? "").length}/2000</p>
        </div>
      </Collapsible>

      <Collapsible title="Additional settings">
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={form.throttle ?? false}
            onChange={(e) => setForm({ ...form, throttle: e.target.checked })}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="font-semibold">Throttle requests</span>
            <span className="text-muted-foreground block text-xs">
              Insert a delay before each request so consecutive page fetches
              don&apos;t burst against the site. Use this only if the target
              site rate-limits or blocks bursts of requests.
            </span>
          </span>
        </label>
        <div className="space-y-2">
          <Label>Custom page timeout</Label>
          <p className="text-muted-foreground text-xs">
            Per-page navigation timeout (in seconds). Leave empty to use the crawler default.
          </p>
          <Input
            type="number"
            min={5}
            max={120}
            value={form.pageTimeoutSecs ?? ""}
            onChange={(e) =>
              setForm({ ...form, pageTimeoutSecs: e.target.value ? Number(e.target.value) : undefined })
            }
            placeholder="30 seconds"
            className="w-40"
          />
        </div>
        <div className="space-y-2">
          <Label>Wait before content extraction</Label>
          <p className="text-muted-foreground text-xs">
            Extra wait (in seconds) after load, for pages rendered by
            JavaScript. Setting this switches to a real-browser crawler.
          </p>
          <Input
            type="number"
            min={1}
            max={30}
            value={form.waitSecs ?? ""}
            onChange={(e) =>
              setForm({ ...form, waitSecs: e.target.value ? Number(e.target.value) : undefined })
            }
            placeholder="2 seconds"
            className="w-40"
          />
        </div>
        <div className="space-y-2">
          <Label>Max pages to crawl (1–50)</Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={form.maxPages ?? 20}
            onChange={(e) => setForm({ ...form, maxPages: Number(e.target.value) })}
            className="w-32"
          />
        </div>
      </Collapsible>

      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={form.loginProtected ?? false}
          onChange={(e) => setForm({ ...form, loginProtected: e.target.checked })}
          className="mt-0.5 size-4"
        />
        <span>
          <span className="text-primary font-semibold">Includes log-in protected content</span>
          <span className="text-muted-foreground block text-xs">
            Noted on the source — authenticated crawling isn&apos;t supported yet.
          </span>
        </span>
      </label>
    </>
  );
}

const PAGES_PER_PAGE = 10;

/** Filterable, paginated list of a website source's crawled pages. */
function CrawledPagesList({
  assistantId,
  source,
  pages,
}: {
  assistantId: string;
  source: Source;
  pages: Concept[];
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);

  const types = [...new Set(pages.map((p) => p.frontmatter.type))];
  const filtered = pages.filter(
    (p) =>
      (typeFilter === "all" || p.frontmatter.type === typeFilter) &&
      ((p.frontmatter.title ?? "").toLowerCase().includes(query.toLowerCase()) ||
        (p.frontmatter.resource ?? "").toLowerCase().includes(query.toLowerCase()))
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGES_PER_PAGE));
  const visible = filtered.slice((page - 1) * PAGES_PER_PAGE, page * PAGES_PER_PAGE);

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{pages.length} Sources</p>
      <div className="flex gap-2">
        <Select
          value={typeFilter}
          onValueChange={(value) => {
            setTypeFilter(value as string);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue>{(v: string) => (v === "all" ? "All types" : v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search"
            className="pl-9"
          />
        </div>
      </div>
      <div className="divide-y rounded-xl border">
        {visible.length === 0 && (
          <p className="text-muted-foreground px-4 py-4 text-center text-sm">No pages found.</p>
        )}
        {visible.map((concept) => (
          <PageRow
            key={concept.id}
            assistantId={assistantId}
            concept={concept}
            siteSchedule={source.recrawlSchedule}
          />
        ))}
      </div>
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              aria-disabled={page === 1}
              className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              onClick={(e) => {
                e.preventDefault();
                if (page > 1) setPage(page - 1);
              }}
            />
          </PaginationItem>
          {paginationRange(page, totalPages).map((item, i) =>
            item === "ellipsis" ? (
              <PaginationItem key={`ellipsis-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={item}>
                <PaginationLink
                  href="#"
                  isActive={item === page}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage(item);
                  }}
                >
                  {item}
                </PaginationLink>
              </PaginationItem>
            )
          )}
          <PaginationItem>
            <PaginationNext
              href="#"
              aria-disabled={page === totalPages}
              className={
                page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
              }
              onClick={(e) => {
                e.preventDefault();
                if (page < totalPages) setPage(page + 1);
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

/** Header shared by the view/edit dialogs: "Entire website" · N Pages · URL. */
function SourceSummary({ source, pageCount }: { source: Source; pageCount: number }) {
  return (
    <DialogDescription className="flex flex-wrap items-center gap-3">
      <Badge variant="outline" className="rounded-full">
        Entire website
      </Badge>
      <span>{pageCount} Pages</span>
      {source.config.url && (
        <a
          href={source.config.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary inline-flex items-center gap-1 hover:underline"
        >
          {source.config.url} <ExternalLink className="size-3" />
        </a>
      )}
    </DialogDescription>
  );
}

/** Read-only pages viewer opened from the "N Pages" count (no config fields). */
function WebsitePagesDialog({
  assistantId,
  source,
  pages,
  onClose,
}: {
  assistantId: string;
  source: Source;
  pages: Concept[];
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Knowledge source: {source.name}</DialogTitle>
          <SourceSummary source={source} pageCount={pages.length} />
        </DialogHeader>
        <CrawledPagesList assistantId={assistantId} source={source} pages={pages} />
      </DialogContent>
    </Dialog>
  );
}

function WebsiteEditDialog({
  assistantId,
  source,
  pages,
  onClose,
  crawl4aiAvailable,
  apifyAvailable,
}: {
  assistantId: string;
  source: Source;
  pages: Concept[];
  onClose: () => void;
  crawl4aiAvailable: boolean;
  apifyAvailable: boolean;
}) {
  const [form, setForm] = useState<WebsiteFormInput>(websiteFormDefaults(source));
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      await updateWebsiteSourceAction(assistantId, source.id, form);
      toast.success("Knowledge source updated");
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit knowledge source: {source.name}</DialogTitle>
          <SourceSummary source={source} pageCount={pages.length} />
        </DialogHeader>

        <div className="space-y-4">
          <WebsiteConfigFields
            form={form}
            setForm={setForm}
            crawl4aiAvailable={crawl4aiAvailable}
            apifyAvailable={apifyAvailable}
          />
          <div className="border-t pt-4">
            <CrawledPagesList assistantId={assistantId} source={source} pages={pages} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isPending} className="font-semibold">
            {isPending ? "Updating…" : "Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const INHERIT = "inherit";

function PageRow({
  assistantId,
  concept,
  siteSchedule,
}: {
  assistantId: string;
  concept: Concept;
  siteSchedule: RecrawlSchedule;
}) {
  const [isPending, startTransition] = useTransition();
  const effective = effectivePageSchedule(concept.recrawlSchedule, siteSchedule);
  return (
    <div className={`space-y-1.5 px-4 py-2.5 ${isPending ? "opacity-50" : ""}`}>
      <p className="truncate text-sm">
        {concept.frontmatter.resource ? (
          <a
            href={concept.frontmatter.resource}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            {concept.frontmatter.title ?? concept.path}
          </a>
        ) : (
          (concept.frontmatter.title ?? concept.path)
        )}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline" className="rounded-md text-[10px]">
          {concept.frontmatter.type}
          {concept.excluded ? " · excluded" : ""}
        </Badge>
        <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={concept.excluded}
            onChange={(e) =>
              startTransition(async () => {
                await setPageExcludedAction(assistantId, concept.id, e.target.checked);
              })
            }
            className="size-3.5"
          />
          Exclude from assistant knowledge
        </label>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          Re-crawl
          <Select
            value={concept.recrawlSchedule ?? INHERIT}
            onValueChange={(value) =>
              startTransition(async () => {
                try {
                  await setPageRecrawlScheduleAction(
                    assistantId,
                    concept.id,
                    value === INHERIT ? null : (value as RecrawlSchedule)
                  );
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Could not save page schedule"
                  );
                }
              })
            }
          >
            <SelectTrigger size="sm" className="h-7 w-[9.5rem]" aria-label="Page re-crawl schedule">
              <SelectValue>
                {(v: string) =>
                  v === INHERIT
                    ? `Inherit (${effective})`
                    : v.charAt(0).toUpperCase() + v.slice(1)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT}>Inherit ({effective})</SelectItem>
              <SelectItem value="never">Never</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </span>
      </div>
    </div>
  );
}

function WebsitesTab({
  assistantId,
  collectionId,
  sources,
  concepts,
  crawl4aiAvailable,
  apifyAvailable,
}: {
  assistantId: string;
  collectionId: string;
  sources: Source[];
  concepts: Concept[];
  crawl4aiAvailable: boolean;
  apifyAvailable: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<WebsiteFormInput>(websiteFormDefaults());
  const [confirmed, setConfirmed] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [viewing, setViewing] = useState<Source | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const websiteSources = sources
    .filter((s) => s.kind === "website" || s.kind === "url")
    .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));

  function pagesOf(source: Source): Concept[] {
    return concepts.filter((c) => c.sourceId === source.id);
  }

  // While any source is still crawling, poll the server until it finishes,
  // then refresh so its status/pages update. The crawl runs on the resolved
  // provider, so this just checks + finalizes — it doesn't hold it open itself.
  const processingIds = sources
    .filter((s) => s.status === "processing")
    .map((s) => s.id)
    .join(",");
  useEffect(() => {
    if (!processingIds) return;
    const ids = processingIds.split(",");
    let cancelled = false;
    const interval = setInterval(async () => {
      let settled = false;
      for (const id of ids) {
        try {
          const status = await pollWebsiteCrawlAction(assistantId, collectionId, id);
          if (status !== "processing") settled = true;
        } catch {
          // transient — try again next tick
        }
      }
      if (settled && !cancelled) router.refresh();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [processingIds, assistantId, collectionId, router]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed) {
      toast.error("Please confirm the copyright checkbox first");
      return;
    }
    startTransition(async () => {
      try {
        await addWebsiteSourceAction(assistantId, collectionId, form);
        toast.success("Crawl started — pages will appear as they're indexed");
        setForm(websiteFormDefaults());
        setShowAdd(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Crawl failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Websites
            <Badge variant="secondary">{websiteSources.length}</Badge>
          </h2>
          <p className="text-muted-foreground text-sm">
            Add your organization&apos;s main website or links to additional
            knowledge bases the assistant should answer questions about.
          </p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)} className="px-5 font-semibold">
          <Plus className="size-4" /> Add
        </Button>
      </div>

      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search websites"
          className="pl-9"
        />
      </div>

      {showAdd && (
        <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-4">
          <WebsiteConfigFields
            form={form}
            setForm={setForm}
            crawl4aiAvailable={crawl4aiAvailable}
            apifyAvailable={apifyAvailable}
          />
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 size-4"
            />
            I confirm that by importing content from the websites above I am
            not violating any copyright regulations.
          </label>
          <div className="flex justify-end">
            <Button type="submit" disabled={isPending} className="px-5 font-semibold">
              <Plus className="size-4" />
              {isPending ? "Starting crawl…" : "Add Website"}
            </Button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="bg-muted/50 text-muted-foreground grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-2 text-xs font-semibold">
          <span>Name</span>
          <span>Status</span>
          <span>Content</span>
          <span>Re-crawl</span>
          <span />
        </div>
        {websiteSources.length === 0 && (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm">
            No websites yet — add your organization&apos;s site to start.
          </p>
        )}
        {websiteSources.map((source) => {
          const pageCount = pagesOf(source).length;
          return (
            <div
              key={source.id}
              className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 border-t px-4 py-3"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Globe className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate">{source.name}</span>
                </span>
                {source.config.url && (
                  <span className="ml-6 block min-w-0">
                    <a
                      href={source.config.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground inline-flex max-w-full items-center gap-1 truncate text-xs hover:underline"
                    >
                      {source.config.url} <ExternalLink className="size-3 shrink-0" />
                    </a>
                    <span className="text-muted-foreground block text-[0.7rem] capitalize">
                      Crawler: {source.config.crawlerProvider ?? "auto"}
                      {source.config.resolvedCrawlerProvider
                        ? ` · Resolved: ${source.config.resolvedCrawlerProvider}`
                        : ""}
                    </span>
                  </span>
                )}
              </span>
              <span>
                <StatusBadge source={source} />
                <span
                  className="text-muted-foreground mt-0.5 block text-xs"
                  suppressHydrationWarning
                >
                  Last update: {new Date(source.updatedAt ?? source.createdAt).toLocaleString()}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setViewing(source)}
                className="text-primary text-sm font-semibold hover:underline disabled:opacity-50"
                disabled={pageCount === 0}
                title={pageCount === 0 ? "No pages crawled yet" : "View crawled pages"}
              >
                {pageCount} Pages
              </button>
              <span className="flex flex-col gap-0.5">
                <Select
                  value={source.recrawlSchedule}
                  onValueChange={(value) =>
                    startTransition(async () => {
                      try {
                        await setRecrawlScheduleAction(
                          assistantId,
                          source.id,
                          value as RecrawlSchedule
                        );
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Could not save schedule"
                        );
                      }
                    })
                  }
                >
                  <SelectTrigger size="sm" className="w-[7.5rem]" aria-label="Re-crawl schedule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <span
                  className="text-muted-foreground text-[0.7rem]"
                  suppressHydrationWarning
                >
                  {crawlScheduleHint(source)}
                </span>
              </span>
              <span className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={source.kind === "website" ? "Re-crawl website" : "Retry ingestion"}
                  disabled={isPending || source.status === "processing"}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        if (source.kind === "website") {
                          await recrawlWebsiteSourceAction(assistantId, collectionId, source.id);
                          toast.success("Website re-crawled");
                        } else {
                          await retrySourceIngestAction(assistantId, collectionId, source.id);
                          toast.success("Retry started");
                        }
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Retry failed");
                      }
                    })
                  }
                >
                  <RefreshCw className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Edit website"
                  onClick={() => setEditing(source)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete website"
                  onClick={() => {
                    if (!window.confirm(`Delete "${source.name}" and its pages?`)) return;
                    startTransition(async () => {
                      await deleteSourceAction(assistantId, source.id);
                    });
                  }}
                >
                  <AnimatedIcon icon={Trash2} size={14} />
                </Button>
              </span>
            </div>
          );
        })}
      </div>

      {viewing && (
        <WebsitePagesDialog
          key={`view-${viewing.id}`}
          assistantId={assistantId}
          source={viewing}
          pages={pagesOf(viewing)}
          onClose={() => setViewing(null)}
        />
      )}

      {editing && (
        <WebsiteEditDialog
          key={editing.id}
          assistantId={assistantId}
          source={editing}
          pages={pagesOf(editing)}
          onClose={() => setEditing(null)}
          crawl4aiAvailable={crawl4aiAvailable}
          apifyAvailable={apifyAvailable}
        />
      )}
    </div>
  );
}

/* ------------------------------ Documents tab ----------------------------- */

function DocumentsTab({
  assistantId,
  collectionId,
  sources,
}: {
  assistantId: string;
  collectionId: string;
  sources: Source[];
}) {
  const [query, setQuery] = useState("");
  const [uploads, setUploads] = useState<FileUploadItem[]>([]);

  const documents = sources
    .filter((s) => s.kind === "file" || s.kind === "text")
    .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));

  function patchUpload(id: string, patch: Partial<FileUploadItem>) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  async function ingest(item: FileUploadItem, file: File) {
    const validation = validateKnowledgeFile({ name: file.name, size: file.size });
    if (!validation.ok) {
      patchUpload(item.id, { status: "error", error: validation.error });
      return;
    }
    const formData = new FormData();
    formData.set("assistantId", assistantId);
    formData.set("collectionId", collectionId);
    formData.set("file", file);
    // The server action reports no byte-level progress, so ramp the bar while
    // ingestion runs and snap it to 100% when the action settles.
    const timer = setInterval(() => {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === item.id && u.status === "uploading"
            ? { ...u, progress: Math.min(90, (u.progress ?? 0) + 4 + Math.random() * 8) }
            : u
        )
      );
    }, 350);
    try {
      const result = await uploadFileSourceAction(formData);
      if (result?.error) {
        patchUpload(item.id, { status: "error", error: result.error });
      } else {
        patchUpload(item.id, { status: "success", progress: 100 });
        toast.success(`"${file.name}" ingested`);
        // The ingested Source now shows in the documents list below — retire
        // the queue row once its success state has had a beat on screen.
        setTimeout(() => {
          setUploads((prev) => prev.filter((u) => u.id !== item.id));
        }, 2000);
      }
    } catch (error) {
      patchUpload(item.id, {
        status: "error",
        error: error instanceof Error ? error.message : "Upload failed",
      });
    } finally {
      clearInterval(timer);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Upload files to add to your assistant&apos;s knowledge base. The
        assistant will use these to answer questions.
      </p>
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents"
          className="pl-9"
        />
      </div>

      <FileUpload
        variant="centered"
        value={uploads}
        onValueChange={setUploads}
        accept=".pdf,.docx,.md,.txt,.markdown"
        title="Drop files here or browse"
        description="PDF, Word (.docx), Markdown, text · up to 25 MB"
        onFilesAdded={(added) => {
          for (const item of added) {
            if (item.file) void ingest(item, item.file);
          }
        }}
        onRetry={(item) => {
          if (item.file) void ingest(item, item.file);
        }}
      />

      {documents.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="bg-muted/50 text-muted-foreground grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2 text-xs font-semibold">
            <span>Name</span>
            <span>Status</span>
            <span />
          </div>
          {documents.map((source) => (
            <div key={source.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-t px-4 py-3">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <Download className="text-muted-foreground size-4 shrink-0" />
                <span className="truncate">{source.name}</span>
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge source={source} />
                <span className="text-muted-foreground text-xs" suppressHydrationWarning>
                  {new Date(source.createdAt).toLocaleString()}
                </span>
              </span>
              <span className="flex items-center gap-1">
                {source.status === "error" && (
                  <RetrySourceButton
                    assistantId={assistantId}
                    collectionId={collectionId}
                    sourceId={source.id}
                  />
                )}
                {source.kind === "file" && source.status !== "error" && (
                  <ReprocessSourceButton
                    assistantId={assistantId}
                    collectionId={collectionId}
                    sourceId={source.id}
                    disabled={source.status === "processing"}
                    hasOriginal={Boolean(source.originalObjectPath)}
                  />
                )}
                <DeleteSourceButton assistantId={assistantId} sourceId={source.id} />
              </span>
              {source.status === "error" && source.error && (
                <p className="text-destructive col-span-3 -mt-2 text-xs">
                  {source.error}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RetrySourceButton({
  assistantId,
  collectionId,
  sourceId,
}: {
  assistantId: string;
  collectionId: string;
  sourceId: string;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Retry ingestion"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          try {
            await retrySourceIngestAction(assistantId, collectionId, sourceId);
            toast.success("Retry started");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Retry failed");
          }
        })
      }
    >
      <RefreshCw className="size-3.5" />
    </Button>
  );
}

function ReprocessSourceButton({
  assistantId,
  collectionId,
  sourceId,
  disabled,
  hasOriginal,
}: {
  assistantId: string;
  collectionId: string;
  sourceId: string;
  disabled: boolean;
  hasOriginal: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const unavailableReason =
    "Original file not stored — re-upload this file to enable re-processing";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={hasOriginal ? "Re-process document" : unavailableReason}
      title={hasOriginal ? "Re-process from the stored original" : unavailableReason}
      disabled={isPending || disabled || !hasOriginal}
      onClick={() =>
        startTransition(async () => {
          try {
            await reprocessSourceAction(assistantId, collectionId, sourceId);
            toast.success("Re-processing started");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Re-process failed");
          }
        })
      }
    >
      <RefreshCw className="size-3.5" />
    </Button>
  );
}

function DeleteSourceButton({ assistantId, sourceId }: { assistantId: string; sourceId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Delete document"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await deleteSourceAction(assistantId, sourceId);
        })
      }
    >
      <AnimatedIcon icon={Trash2} size={14} />
    </Button>
  );
}

/* -------------------------------- FAQs tab -------------------------------- */

/** One answer-toolbar command over the markdown textarea. */
type FaqToolbarCommand =
  | { wrap: string; wrapEnd?: string }
  | { prefix: string }
  | { transform: (selected: string) => string };

const FAQ_TOOLBAR: Array<
  Array<{ label: string; Icon: typeof Bold; command: FaqToolbarCommand }>
> = [
  [
    { label: "Bold", Icon: Bold, command: { wrap: "**" } },
    { label: "Italic", Icon: Italic, command: { wrap: "*" } },
    {
      label: "Clear formatting",
      Icon: RemoveFormatting,
      command: {
        transform: (s) =>
          s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|\*|`|^#+\s/gm, ""),
      },
    },
    { label: "Code", Icon: Code, command: { wrap: "`" } },
  ],
  [
    { label: "Heading 1", Icon: Heading1, command: { prefix: "# " } },
    { label: "Heading 2", Icon: Heading2, command: { prefix: "## " } },
    { label: "Heading 3", Icon: Heading3, command: { prefix: "### " } },
    { label: "Heading 4", Icon: Heading4, command: { prefix: "#### " } },
  ],
  [
    { label: "Blockquote", Icon: TextQuote, command: { prefix: "> " } },
    { label: "Divider", Icon: Minus, command: { prefix: "\n---\n" } },
    { label: "Bullet list", Icon: List, command: { prefix: "- " } },
    { label: "Numbered list", Icon: ListOrdered, command: { prefix: "1. " } },
  ],
  [
    { label: "Link", Icon: Link2, command: { wrap: "[", wrapEnd: "](url)" } },
    {
      label: "Remove link",
      Icon: Unlink,
      command: { transform: (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") },
    },
  ],
];

function FaqDialog({
  assistantId,
  collectionId,
  faq,
  open,
  onClose,
}: {
  assistantId: string;
  collectionId: string;
  faq: Concept | null;
  open: boolean;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState(faq?.frontmatter.title ?? "");
  const [answer, setAnswer] = useState(faq?.body ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const [isPending, startTransition] = useTransition();
  const answerRef = useRef<HTMLTextAreaElement>(null);
  // Char-granular undo/redo over the answer, like the reference editor.
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);

  const questionMissing = !question.trim();

  function setAnswerTracked(next: string) {
    undoStack.current.push(answer);
    if (undoStack.current.length > 500) undoStack.current.shift();
    redoStack.current = [];
    setAnswer(next.slice(0, 20000));
  }

  function undo() {
    const previous = undoStack.current.pop();
    if (previous === undefined) return;
    redoStack.current.push(answer);
    setAnswer(previous);
  }

  function redo() {
    const next = redoStack.current.pop();
    if (next === undefined) return;
    undoStack.current.push(answer);
    setAnswer(next);
  }

  function applyCommand(command: FaqToolbarCommand) {
    const el = answerRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const selected = value.slice(selectionStart, selectionEnd);
    let next: string;
    if ("wrap" in command) {
      const end = command.wrapEnd ?? command.wrap;
      next = value.slice(0, selectionStart) + command.wrap + selected + end + value.slice(selectionEnd);
    } else if ("prefix" in command) {
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
      next = value.slice(0, lineStart) + command.prefix + value.slice(lineStart);
    } else {
      next = value.slice(0, selectionStart) + command.transform(selected) + value.slice(selectionEnd);
    }
    setAnswerTracked(next);
    requestAnimationFrame(() => el.focus());
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (questionMissing || !answer.trim()) {
      setShowErrors(true);
      return;
    }
    startTransition(async () => {
      if (faq) {
        await updateFaqAction(assistantId, faq.id, question, answer);
        toast.success("FAQ updated");
      } else {
        await createFaqAction(assistantId, collectionId, question, answer);
        toast.success("FAQ added");
      }
      onClose();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{faq ? "Edit FAQ Knowledge" : "Add New FAQ Knowledge"}</DialogTitle>
          <DialogDescription>Add free text content to the knowledge of your assistant</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="faq-q">
              Question <span className="text-destructive">*</span>
            </Label>
            <Input
              id="faq-q"
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, 1000))}
              placeholder="Enter the question or title of your content.."
              autoFocus={!faq}
              aria-invalid={showErrors && questionMissing}
              className={
                showErrors && questionMissing
                  ? "border-destructive placeholder:text-destructive/70 focus-visible:ring-destructive/30"
                  : undefined
              }
            />
            <div className="flex items-center justify-between text-xs">
              <span className="text-destructive">
                {showErrors && questionMissing ? "Question is required" : ""}
              </span>
              <span className="text-muted-foreground">{question.length}/1000</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="faq-a">
              Answer <span className="text-destructive">*</span>
            </Label>
            <p className="text-muted-foreground text-xs">We recommend adding at least 100 words</p>
            <div className="rounded-xl border">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-2 py-1.5">
                {FAQ_TOOLBAR.map((group, g) => (
                  <span key={g} className="flex items-center gap-0.5">
                    {group.map((btn) => (
                      <Button
                        key={btn.label}
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        title={btn.label}
                        aria-label={btn.label}
                        onClick={() => applyCommand(btn.command)}
                      >
                        <btn.Icon className="size-4" />
                      </Button>
                    ))}
                  </span>
                ))}
                <span className="flex items-center gap-0.5">
                  <Button type="button" variant="ghost" size="icon-sm" title="Undo" aria-label="Undo" onClick={undo}>
                    <Undo2 className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" title="Redo" aria-label="Redo" onClick={redo}>
                    <Redo2 className="size-4" />
                  </Button>
                </span>
              </div>
              <Textarea
                id="faq-a"
                ref={answerRef}
                value={answer}
                onChange={(e) => setAnswerTracked(e.target.value)}
                placeholder="Enter your answer or content here.."
                rows={12}
                className="resize-none rounded-t-none border-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-destructive">
                {showErrors && !answer.trim() ? "Answer is required" : ""}
              </span>
              <span className="text-muted-foreground">{answer.length}/20000</span>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="font-semibold">
              {isPending ? "Saving…" : faq ? "Save FAQ" : "Add FAQ Knowledge"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The "Import FAQs" CSV modal — click-to-upload / drag-drop, two-column contract. */
function ImportFaqsDialog({
  assistantId,
  collectionId,
  onClose,
}: {
  assistantId: string;
  collectionId: string;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function pick(candidate: File | undefined) {
    if (!candidate) return;
    if (!/\.csv$/i.test(candidate.name) && candidate.type !== "text/csv") {
      toast.error("Please choose a CSV file");
      return;
    }
    if (candidate.size > FAQ_CSV_MAX_BYTES) {
      toast.error("File is too large — the maximum supported size is 10 MB");
      return;
    }
    setFile(candidate);
  }

  function upload() {
    if (!file) return;
    const formData = new FormData();
    formData.set("assistantId", assistantId);
    formData.set("collectionId", collectionId);
    formData.set("file", file);
    startTransition(async () => {
      try {
        const { imported, skipped } = await importFaqsAction(formData);
        if (imported > 0) {
          toast.success(
            `Imported ${imported} FAQ${imported === 1 ? "" : "s"}` +
              (skipped.length > 0 ? ` · ${skipped.length} row${skipped.length === 1 ? "" : "s"} skipped` : "")
          );
        } else {
          toast.error(
            skipped.length > 0
              ? `Nothing imported — ${skipped[0]}`
              : "Nothing imported — the file has no valid rows"
          );
        }
        if (imported > 0) onClose();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Import failed");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import FAQs</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files?.[0]);
            }}
            className={`flex flex-col items-center justify-center rounded-xl border px-6 py-10 text-center transition-colors ${
              dragging ? "border-primary bg-primary/5" : ""
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <span className="flex size-12 items-center justify-center rounded-xl border">
              <CloudUpload className="size-5" />
            </span>
            <p className="mt-4 text-[15px]">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-primary font-semibold hover:underline"
              >
                Click to upload
              </button>{" "}
              or drag and drop
            </p>
            <p className="text-muted-foreground mt-0.5 text-sm">CSV file.</p>
            {file && (
              <p className="mt-3 text-sm font-medium">
                {file.name}{" "}
                <span className="text-muted-foreground">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </p>
            )}
          </div>

          <div className="bg-muted/40 flex gap-3 rounded-xl border px-4 py-4">
            <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
              <Info className="size-4" />
            </span>
            <div className="text-sm">
              <p className="font-semibold">
                Please note that only two columns are expected in the CSV file.
              </p>
              <p className="text-muted-foreground mt-1.5">
                Questions can be up to 1000 characters, and answers can be up to
                20000 characters.
                <br />
                Maximum supported file size is 10 MB.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={upload}
            disabled={!file || isPending}
            className="font-semibold"
          >
            {isPending ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FaqsTab({
  assistantId,
  collectionId,
  faqs,
}: {
  assistantId: string;
  collectionId: string;
  faqs: Concept[];
}) {
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Concept | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = faqs.filter(
    (f) =>
      (f.frontmatter.title ?? "").toLowerCase().includes(query.toLowerCase()) ||
      f.body.toLowerCase().includes(query.toLowerCase())
  );

  function exportCsv() {
    const csv = serializeFaqCsv(
      faqs.map((f) => ({
        question: f.frontmatter.title ?? f.path,
        answer: f.body,
      }))
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "faqs.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Questions and Answers
            <Badge variant="secondary">{faqs.length}</Badge>
          </h2>
          <p className="text-muted-foreground text-sm">Add sets of questions and answers to fine tune AI responses.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={faqs.length === 0}
            className="font-semibold"
          >
            Export
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button className="px-5 font-semibold" />}
            >
              <Plus className="size-4" /> New FAQ <ChevronDown className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="size-4" /> Single Q&amp;A
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportOpen(true)}>
                <FileUp className="size-4" /> Import FAQs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search FAQs" className="pl-9" />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="bg-muted/50 text-muted-foreground grid grid-cols-[1fr_1fr_auto_auto] gap-4 px-4 py-2 text-xs font-semibold">
          <span>Question</span>
          <span>Answer</span>
          <span>Status</span>
          <span />
        </div>
        {filtered.length === 0 && (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm">No FAQs yet — add one to fine-tune answers.</p>
        )}
        {filtered.map((faq) => {
          const trust = conceptProvenanceView(faq.frontmatter);
          return (
          <div key={faq.id} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-4 border-t px-4 py-3">
            <span className="line-clamp-2 text-sm font-medium">{faq.frontmatter.title}</span>
            <span className="text-muted-foreground line-clamp-2 text-sm">{faq.body}</span>
            <span className="flex items-center gap-1.5">
              {/* Trust tier (OKF §5.3) — the FAQ list is where it matters most:
                  an accepted Suggested Fix is agent-drafted but human-reviewed,
                  a hand-typed FAQ is neither. Unverified stays unlabelled, since
                  a badge on every row would carry no signal. */}
              {trust.tier !== "unverified" && (
                <Badge
                  variant={trust.tier === "human-reviewed" ? "default" : "secondary"}
                  className="shrink-0 rounded-full"
                >
                  {trust.trustLabel}
                </Badge>
              )}
              <Badge variant="outline" className="text-muted-foreground gap-1.5 rounded-full bg-muted/40">
                READY
              </Badge>
            </span>
            <span className="flex gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit FAQ"
                onClick={() => {
                  setEditing(faq);
                  setDialogOpen(true);
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete FAQ"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await deleteConceptAction(assistantId, faq.id);
                  })
                }
              >
                <AnimatedIcon icon={Trash2} size={14} />
              </Button>
            </span>
          </div>
          );
        })}
      </div>

      {dialogOpen && (
        <FaqDialog
          key={editing?.id ?? "new"}
          assistantId={assistantId}
          collectionId={collectionId}
          faq={editing}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      )}
      {importOpen && (
        <ImportFaqsDialog
          assistantId={assistantId}
          collectionId={collectionId}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------- OKF browser ------------------------------ */

function ConceptCard({ assistantId, concept }: { assistantId: string; concept: Concept }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const provenance = conceptProvenanceView(concept.frontmatter);
  return (
    <div className={`rounded-xl border ${isPending ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button type="button" onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
          <code className="text-muted-foreground shrink-0 font-mono text-xs">{concept.path}</code>
          <span className="truncate text-sm font-medium">{concept.frontmatter.title ?? concept.path}</span>
        </button>
        {provenance.tier !== "unverified" && (
          <Badge
            variant={provenance.tier === "human-reviewed" ? "default" : "secondary"}
            className="shrink-0 rounded-full"
          >
            {provenance.trustLabel}
          </Badge>
        )}
        {provenance.showStatus && (
          <Badge variant="secondary" className="shrink-0 rounded-full capitalize">
            {provenance.status}
          </Badge>
        )}
        {provenance.stale && (
          <Badge variant="destructive" className="shrink-0 rounded-full">Stale</Badge>
        )}
        <Badge variant="outline" className="shrink-0 rounded-full">{concept.frontmatter.type}</Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete concept"
          onClick={() =>
            startTransition(async () => {
              await deleteConceptAction(assistantId, concept.id);
            })
          }
        >
          <AnimatedIcon icon={Trash2} size={14} />
        </Button>
      </div>
      {open && (
        <div className="border-t px-4 py-3">
          {concept.frontmatter.description && (
            <p className="text-muted-foreground mb-2 text-xs italic">{concept.frontmatter.description}</p>
          )}
          <dl className="text-muted-foreground mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {provenance.generatedBy && (
              <>
                <dt className="font-medium">Generated by</dt>
                <dd className="font-mono break-all">
                  {provenance.generatedBy}
                  {provenance.generatedAt ? ` · ${provenance.generatedAt}` : ""}
                </dd>
              </>
            )}
            {provenance.verifiedBy && (
              <>
                <dt className="font-medium">Verified by</dt>
                <dd className="font-mono break-all">
                  {provenance.verifiedBy}
                  {provenance.verifiedAt ? ` · ${provenance.verifiedAt}` : ""}
                </dd>
              </>
            )}
            {provenance.sources.length > 0 && (
              <>
                <dt className="font-medium">Derived from</dt>
                <dd className="min-w-0">
                  <ul className="space-y-0.5">
                    {provenance.sources.map((source) => (
                      <li key={source.label} className="truncate">
                        {source.href ? (
                          <a
                            href={source.href}
                            target="_blank"
                            rel="noreferrer"
                            className="underline underline-offset-2"
                          >
                            {source.label}
                          </a>
                        ) : (
                          source.label
                        )}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
          <pre className="text-muted-foreground max-h-64 overflow-y-auto text-xs whitespace-pre-wrap">
            {concept.body.slice(0, 3000)}
          </pre>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Shell ---------------------------------- */

export function KnowledgeClient({
  assistantId,
  selected,
  sources,
  concepts,
  crawl4aiAvailable = false,
  apifyAvailable = false,
  nullEmbeddingCount = 0,
}: {
  assistantId: string;
  selected: KnowledgeCollection | null;
  sources: Source[];
  concepts: Concept[];
  crawl4aiAvailable?: boolean;
  apifyAvailable?: boolean;
  /** Concepts whose chunks miss embeddings (lexical-only until re-embedded). */
  nullEmbeddingCount?: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("websites");
  const [isPending, startTransition] = useTransition();

  // Ingestion runs off the request path (Ingestion Jobs); poll while any
  // Source is still processing so its status settles without a manual reload.
  const hasProcessing = sources.some((s) => s.status === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [hasProcessing, router]);

  const faqs = concepts.filter((c) => c.frontmatter.type === "FAQ");
  const nonFaqConcepts = concepts.filter((c) => c.frontmatter.type !== "FAQ");

  return (
    <div className="mt-6 space-y-6 pb-16">
      {/* Re-embed backfill (#312): content ingested without embeddings is
          reachable only lexically until re-indexed with a working provider. */}
      {nullEmbeddingCount > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm dark:border-amber-400/30 dark:bg-amber-950/30">
          <p>
            {nullEmbeddingCount} concept{nullEmbeddingCount === 1 ? "" : "s"}{" "}
            {nullEmbeddingCount === 1 ? "is" : "are"} missing embeddings and
            only found by keyword search. Re-embed once an embedding-capable
            provider (OpenAI or Google) is connected.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await reembedKnowledgeAction(assistantId);
                router.refresh();
              })
            }
          >
            {isPending ? "Re-embedding…" : "Re-embed"}
          </Button>
        </div>
      )}
      {selected ? (
        <>
          {/* Mode tabs */}
          <div className="bg-muted/60 inline-flex rounded-xl border p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                  mode === m.id ? "text-primary bg-primary/10 shadow-xs dark:bg-primary/20" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === "websites" && (
            <WebsitesTab
              assistantId={assistantId}
              collectionId={selected.id}
              sources={sources}
              concepts={concepts}
              crawl4aiAvailable={crawl4aiAvailable}
              apifyAvailable={apifyAvailable}
            />
          )}
          {mode === "documents" && (
            <DocumentsTab assistantId={assistantId} collectionId={selected.id} sources={sources} />
          )}
          {mode === "faqs" && <FaqsTab assistantId={assistantId} collectionId={selected.id} faqs={faqs} />}
          {mode === "okf" && (
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm">
                OKF bundle · {nonFaqConcepts.length} concept document{nonFaqConcepts.length === 1 ? "" : "s"} (ADR-0002).
              </p>
              {nonFaqConcepts.map((concept) => (
                <ConceptCard key={concept.id} assistantId={assistantId} concept={concept} />
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          This assistant&apos;s knowledge area is being prepared. Refresh in a
          moment, or ask an editor to add knowledge sources.
        </p>
      )}
    </div>
  );
}
