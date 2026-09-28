"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ApplicationImport,
  ApplicationSyncRun,
  Concept,
  KnowledgeCollection,
  RecrawlSchedule,
  Source,
  WebsiteCrawlerProvider,
} from "@agent-hub/core";
import type { KnowledgeMode } from "@/lib/knowledge-mode";
import {
  ApplicationKnowledgePanel,
} from "@/components/knowledge/application-knowledge-panel";
import type { PublicApplicationConnection } from "@/lib/application-connections";
import type { ApplicationOAuthAvailability } from "@/lib/application-oauth";
import {
  DEFAULT_PAGE_BUDGET,
  isUnlimitedPages,
  NO_PAGE_LIMIT,
  nextCrawlDue,
} from "@agent-hub/core";

import { conceptProvenanceView, type ConceptProvenanceView } from "@/lib/okf-provenance";
import { assistantDocumentsHref } from "@/lib/source-documents";
import { Bold, CloudUpload, Download, Copy, ExternalLink, Heading1, Heading2, Heading3, Heading4, Italic, Plus, RefreshCw, RemoveFormatting, TextQuote, Trash2, Unlink } from "lucide-react";
import { ChevronDown, Code, FileUp, Globe, Info, Link2, List, ListOrdered, Maximize2, Minus, Pencil, Redo2, Undo2 } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  useConfirmDelete,
  type ConfirmDeleteRequest,
} from "@/components/ui/confirm-delete-modal";
import {
  bulkRemovalChoice,
  SOURCE_STATUS_OPTIONS,
  sourceRemovalChoice,
  tabSources,
} from "@/lib/knowledge-hub";
import { ingestionStarted } from "@/lib/ingestion-bus";
import { toast } from "@/lib/toast";
import { copyToClipboard } from "@/lib/clipboard";
import {
  addWebsiteSourceAction,
  createFaqAction,
  reembedKnowledgeAction,
  deleteConceptAction,
  deleteOrgSourceAction,
  unlinkSourceAction,
  unlinkSourcesAction,
  deleteConceptsAction,
  deleteOrgSourcesAction,
  importFaqsAction,
  pollWebsiteCrawlAction,
  recrawlSourceAction,
  reprocessSourceAction,
  retrySourceIngestAction,
  setRecrawlScheduleAction,
  updateOrgFaqAction,
  updateWebsiteSourceAction,
  uploadFileSourceAction,
  type WebsiteFormInput,
} from "@/app/actions";
import { FAQ_CSV_MAX_BYTES, serializeFaqCsv } from "@/lib/faq-csv";
import { validateKnowledgeFile } from "@/lib/storage/assets";
import { FileUpload, type FileUploadItem } from "@/components/ui/file-upload";
import { Switch } from "@/components/ui/motion-switch";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableActions,
  TableBody,
  TableCard,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import {
  TableColumnHeader,
  useClientPage,
  useClientSort,
} from "@/components/ui/table-column-header";
import {
  useColumnWidths,
  type TableColumnLayout,
} from "@/components/ui/table-columns";
import { TableOpenCell } from "@/components/ui/table-open-cell";
import { TableRowMenu } from "@/components/ui/table-menu";
import {
  SelectAllHead,
  SelectRowCell,
  TableBulkBar,
  useRowSelection,
  type RowSelection,
} from "@/components/ui/table-selection";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCount, formatDateTime, formatDay } from "@/lib/format";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { canAutoFocus } from "@/lib/auto-focus";
import { downloadFile } from "@/lib/download";
import { applyMarkdownCommand, type MarkdownCommand } from "@/lib/markdown-toolbar";
import { useUnsavedChanges } from "@/components/ui/use-unsaved-changes";

const MODES: Array<{ id: KnowledgeMode; label: string }> = [
  { id: "websites", label: "Websites" },
  { id: "documents", label: "Documents" },
  { id: "applications", label: "Applications" },
  { id: "faqs", label: "FAQs" },
  { id: "concepts", label: "Concepts" },
];

function StatusBadge({ source }: { source: Source }) {
  // One Badge for every status, children in fixed slots, so React keeps the
  // same RollInText across a change and Processing… rolls into READY rather
  // than being swapped out for a new element.
  const status = source.status;
  const label =
    status === "ready" ? "READY" : status === "error" ? "ERROR" : "Processing…";
  return (
    <Badge
      variant={status === "error" ? "default" : "outline"}
      tone={status === "error" ? "red" : "none"}
      title={status === "error" ? source.error : undefined}
      className={
        status === "ready"
          ? "text-muted-foreground gap-1.5 rounded-full bg-muted/40"
          : status === "error"
            ? undefined
            : "rounded-full"
      }
    >
      {status === "ready" && <span className="size-1.5 rounded-full bg-foreground" />}
      <RollInText
        text={label}
        className={
          status === "processing" ? "animate-pulse motion-reduce:animate-none" : undefined
        }
      />
    </Badge>
  );
}

/** "12/100": the count rolls as it changes, the limit stays put. */
function CharCount({ count, max }: { count: number; max: number }) {
  return (
    <span className="tabular-nums">
      <RollingNumber value={count} />/{formatCount(max)}
    </span>
  );
}

/** `n Documents`, pluralised, the count rolling. */
function DocumentCount({ count }: { count: number }) {
  return (
    <>
      <RollingNumber value={count} /> {count === 1 ? "Document" : "Documents"}
    </>
  );
}

/** "Never crawled" / "Last …" plus the next scheduled crawl, if any. */
function crawlScheduleHint(source: Source): string {
  const last = source.lastCrawledAt
    ? `Last: ${formatDay(source.lastCrawledAt)}`
    : "Never crawled";
  const due = nextCrawlDue(source.recrawlSchedule, source.lastCrawledAt);
  return due ? `${last} · Next: ${formatDay(due)}` : last;
}

function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="bg-muted/50 rounded-xl">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="text-primary flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold"
      >
        <ChevronDown className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`} />
        {title}
      </button>
      {open && (
        <div id={panelId} className="space-y-3 px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Websites tab ------------------------------ */

/**
 * A new Source asks for no page limit when the Organization has its own Apify
 * account, because that crawl bills the Organization and runs to the end of
 * the site; everywhere else it keeps the historic 20.
 */
function websiteFormDefaults(
  source?: Source,
  apifyOrgConnected = false
): WebsiteFormInput {
  return {
    name: source?.name ?? "",
    url: source?.config.url ?? "",
    crawlerProvider: source?.config.crawlerProvider ?? "auto",
    maxPages:
      source?.config.maxPages ??
      (source || !apifyOrgConnected ? DEFAULT_PAGE_BUDGET : NO_PAGE_LIMIT),
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
  crawl4aiAvailable,
  apifyAvailable,
}: {
  form: WebsiteFormInput;
  setForm: (f: WebsiteFormInput) => void;
  crawl4aiAvailable: boolean;
  apifyAvailable: boolean;
}) {
  const id = useId();
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`}>
          Name of Knowledge source <span className="text-destructive">*</span>
        </Label>
        <p className="text-muted-foreground text-xs">A generic name that can help you remember it.</p>
        <Input
          id={`${id}-name`}
          name="name"
          autoComplete="off"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value.slice(0, 100) })}
          placeholder="Enter name of website"
          required
        />
        <p className="text-muted-foreground text-right text-xs">
          <CharCount count={form.name.length} max={100} />
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${id}-url`}>
          Knowledge Base URL <span className="text-destructive">*</span>
        </Label>
        <p className="text-muted-foreground text-xs">The URL of the website whose content you want to import.</p>
        <Input
          id={`${id}-url`}
          name="url"
          type="url"
          autoComplete="url"
          spellCheck={false}
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value.slice(0, 300) })}
          placeholder="https://example.com"
          required
        />
        <p className="text-muted-foreground text-right text-xs">
          <CharCount count={form.url.length} max={300} />
        </p>
      </div>

      <div className="space-y-2">
        <Label>Web crawler</Label>
        <p className="text-muted-foreground text-xs">
          Automatic picks the right crawler for each site. Choose one to force it for the next crawl.
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
          <Label htmlFor={`${id}-include`}>Positive Search Filters</Label>
          <p className="text-muted-foreground text-xs">Only crawl URLs matching these globs (one per line).</p>
          <Textarea
            id={`${id}-include`}
            spellCheck={false}
            value={form.includeGlobs}
            onChange={(e) => setForm({ ...form, includeGlobs: e.target.value.slice(0, 2000) })}
            placeholder={"https://example.com/docs/**"}
            rows={3}
          />
          <p className="text-muted-foreground text-right text-xs">
            <CharCount count={(form.includeGlobs ?? "").length} max={2000} />
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-exclude`}>Negative Search Filters</Label>
          <p className="text-muted-foreground text-xs">Skip URLs matching these globs (one per line).</p>
          <Textarea
            id={`${id}-exclude`}
            spellCheck={false}
            value={form.excludeGlobs}
            onChange={(e) => setForm({ ...form, excludeGlobs: e.target.value.slice(0, 2000) })}
            placeholder={"https://example.com/blog/**"}
            rows={3}
          />
          <p className="text-muted-foreground text-right text-xs">
            <CharCount count={(form.excludeGlobs ?? "").length} max={2000} />
          </p>
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
              Wait between requests. Use it only if the site rate-limits crawlers.
            </span>
          </span>
        </label>
        <div className="space-y-2">
          <Label htmlFor={`${id}-timeout`}>Custom page timeout</Label>
          <p className="text-muted-foreground text-xs">
            Per-page navigation timeout (in seconds). Leave empty to use the crawler default.
          </p>
          <Input
            id={`${id}-timeout`}
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
          <Label htmlFor={`${id}-wait`}>Wait before content extraction</Label>
          <p className="text-muted-foreground text-xs">
            Extra seconds to wait for JavaScript pages. Uses a real-browser crawler.
          </p>
          <Input
            id={`${id}-wait`}
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
          <Label htmlFor={`${id}-max-pages`}>Max pages to crawl</Label>
          <p className="text-muted-foreground text-xs">
            Up to 30 pages run locally, up to 5,000 on Crawl4AI, more on Apify. No limit crawls the whole site on your own Apify account.
          </p>
          <div className="flex items-center gap-4">
            <PageBudgetInput
              id={`${id}-max-pages`}
              budget={
                isUnlimitedPages(form.maxPages)
                  ? null
                  : (form.maxPages ?? DEFAULT_PAGE_BUDGET)
              }
              onBudgetChange={(maxPages) => setForm({ ...form, maxPages })}
            />
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={isUnlimitedPages(form.maxPages)}
                onCheckedChange={(on) =>
                  setForm({
                    ...form,
                    maxPages: on ? NO_PAGE_LIMIT : DEFAULT_PAGE_BUDGET,
                  })
                }
                aria-label="No page limit"
              />
              No page limit
            </label>
          </div>
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
            Noted on the source: authenticated crawling isn&apos;t supported yet.
          </span>
        </span>
      </label>
    </>
  );
}

/**
 * The page budget as typed text. `NO_PAGE_LIMIT` is 0, so `Number("")` from a
 * cleared field used to switch on an unlimited crawl the Organization pays
 * for. Only a whole number of at least one reaches the form; anything else
 * (empty, mid-edit) stays local and the last valid budget stands, restored to
 * the field on blur. Unlimited is the switch's job alone.
 */
function PageBudgetInput({
  id,
  budget,
  onBudgetChange,
}: {
  id: string;
  /** null while the "No page limit" switch is on. */
  budget: number | null;
  onBudgetChange: (pages: number) => void;
}) {
  const shown = budget === null ? "" : String(budget);
  const [text, setText] = useState(shown);
  const [synced, setSynced] = useState(shown);
  // The switch (or a reset) moved the budget from outside: show that.
  if (shown !== synced) {
    setSynced(shown);
    setText(shown);
  }
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={1}
      max={100_000}
      disabled={budget === null}
      value={text}
      placeholder="No limit"
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const pages = Number(next);
        if (next.trim() !== "" && Number.isInteger(pages) && pages >= 1) {
          onBudgetChange(pages);
        }
      }}
      onBlur={() => setText(shown)}
      className="w-32"
    />
  );
}

/** Header shared by the view/edit dialogs: "Entire website" · N Documents · URL. */
function SourceSummary({
  source,
  documentCount,
}: {
  source: Source;
  documentCount: number;
}) {
  return (
    <DialogDescription className="flex min-w-0 flex-wrap items-center gap-3">
      <Badge variant="outline" className="rounded-full">
        Entire website
      </Badge>
      <span>
        <DocumentCount count={documentCount} />
      </span>
      {source.config.url && (
        <a
          href={source.config.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary inline-flex min-w-0 items-center gap-1 hover:underline"
        >
          <span className="min-w-0 break-all">{source.config.url}</span>
          <ExternalLink className="size-3 shrink-0" />
        </a>
      )}
    </DialogDescription>
  );
}

function WebsiteEditDialog({
  assistantId,
  source,
  documents,
  onClose,
  crawl4aiAvailable,
  apifyAvailable,
}: {
  assistantId: string;
  source: Source;
  documents: Concept[];
  onClose: () => void;
  crawl4aiAvailable: boolean;
  apifyAvailable: boolean;
}) {
  const [initial] = useState(() => websiteFormDefaults(source));
  const [form, setForm] = useState<WebsiteFormInput>(initial);
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const { leave } = useUnsavedChanges({
    dirty,
    confirmDelete,
    description: "The edits to this website are not saved yet.",
  });

  function requestClose() {
    if (isPending) return;
    leave(onClose);
  }

  function save() {
    startTransition(async () => {
      try {
        await updateWebsiteSourceAction(assistantId, source.id, form);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update the website"
        );
        return;
      }
      toast.success("Knowledge source updated");
      onClose();
    });
  }

  return (
    <>
    {confirmDeleteModal}
    <Dialog open onOpenChange={(o) => !o && requestClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit knowledge source: {source.name}</DialogTitle>
          <SourceSummary source={source} documentCount={documents.length} />
        </DialogHeader>

        <div className="space-y-4">
          <WebsiteConfigFields
            form={form}
            setForm={setForm}
            crawl4aiAvailable={crawl4aiAvailable}
            apifyAvailable={apifyAvailable}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={requestClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isPending} className="font-semibold">
            <RollInText text={isPending ? "Updating…" : "Update"} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

/**
 * Binds `sourceRemovalChoice` to the two actions: unlink for a shared Source,
 * delete for one only this assistant answers from. The copy and the choice
 * itself live in lib/knowledge-hub.ts, where they are unit-tested.
 */
function removeSourceRequest(args: {
  assistantId: string;
  sourceId: string;
  name: string;
  sharedWith: string[] | undefined;
  deleteLabel: string;
  deleteEffect: string;
}): ConfirmDeleteRequest {
  const choice = sourceRemovalChoice(args);
  const remove = () =>
    choice.mode === "unlink"
      ? unlinkSourceAction(args.assistantId, args.sourceId)
      : deleteOrgSourceAction(args.sourceId);
  return {
    title:
      choice.mode === "unlink" ? (
        <>Remove &ldquo;{choice.name}&rdquo; from this assistant?</>
      ) : (
        <>Delete &ldquo;{choice.name}&rdquo;?</>
      ),
    description: choice.description,
    confirmLabel: choice.confirmLabel,
    onConfirm: remove,
    secondaryLabel: choice.secondaryLabel,
    onSecondary: choice.secondaryLabel
      ? () => deleteOrgSourceAction(args.sourceId)
      : undefined,
  };
}

/**
 * The bulk bar over an Assistant's Knowledge tables.
 *
 * One button, two outcomes, the same pair `removeSourceRequest` offers per
 * row: remove these Sources from this Assistant, or delete them for the whole
 * Organization. It is a dialog rather than two buttons in the bar because
 * with twenty rows ticked the difference between the two is the whole
 * decision, and a bar button is not where that gets read.
 *
 * Unlike the per-row menu it never infers the choice from whether a row
 * happens to be shared: across a selection, half of them usually are.
 */
function SourceBulkBar({
  assistantId,
  selection,
  noun,
  pluralNoun,
  deleteEffect,
}: {
  assistantId: string;
  selection: RowSelection;
  noun: string;
  pluralNoun?: string;
  /**
   * What the org-wide delete takes with it, in a clause that finishes
   * "…removes it/them everywhere: ". It reads the count because a selection
   * of one and a selection of twelve are different sentences.
   */
  deleteEffect: (one: boolean) => string;
}) {
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const plural = pluralNoun ?? `${noun}s`;
  return (
    <>
      <TableBulkBar
        count={selection.count}
        noun={noun}
        pluralNoun={pluralNoun}
        onClear={selection.clear}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const ids = selection.ids;
            const one = ids.length === 1;
            const what = `${ids.length} ${one ? noun : plural}`;
            confirmDelete({
              title: `Remove ${what} from this assistant?`,
              description: one
                ? `It stays in the Library and keeps answering for every other assistant linked to it. Deleting it for the organization instead removes it everywhere: ${deleteEffect(true)}`
                : `They stay in the Library and keep answering for every other assistant linked to them. Deleting them for the organization instead removes them everywhere: ${deleteEffect(false)}`,
              confirmLabel: "Remove from this assistant",
              onConfirm: async () => {
                await unlinkSourcesAction(assistantId, ids);
                selection.clear();
              },
              secondaryLabel: "Delete for the organization",
              onSecondary: async () => {
                await deleteOrgSourcesAction(ids);
                selection.clear();
              },
            });
          }}
        >
          <Unlink className="mr-1.5 size-4" /> Remove
        </Button>
      </TableBulkBar>
      {confirmDeleteModal}
    </>
  );
}

function WebsitesTab({
  assistantId,
  collectionId,
  sources,
  concepts,
  sharedWith,
  crawl4aiAvailable,
  apifyAvailable,
  apifyOrgConnected,
}: {
  assistantId: string;
  collectionId: string;
  sources: Source[];
  concepts: Concept[];
  /** sourceId → the other assistants answering from it (PRD #726). */
  sharedWith: Record<string, string[]>;
  crawl4aiAvailable: boolean;
  apifyAvailable: boolean;
  /** The Organization connected its own Apify account (Settings → Crawling). */
  apifyOrgConnected: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<WebsiteFormInput>(
    websiteFormDefaults(undefined, apifyOrgConnected)
  );
  const [confirmed, setConfirmed] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState("");
  const order = useClientSort();
  const websiteSources = order.sorted(
    tabSources(sources, "websites", { query, status: statusFilter }),
    {
      name: (s) => s.name,
      status: (s) => s.status,
      content: (s) => documentsOf(s).length,
      recrawl: (s) => s.recrawlSchedule,
    }
  );
  // The same footer the Library has, over rows this component already holds:
  // "Showing 1-25 of 61", a rows-per-page control and the page arrows,
  // rather than a bare count that behaves differently from its twin.
  const paged = useClientPage(websiteSources);
  const selection = useRowSelection(paged.items.map((s) => s.id));
  const columns = useColumnWidths("assistant-websites", [
    { key: "select", width: 44, fixed: true },
    { key: "name", width: 380, min: 200 },
    { key: "status", width: 200 },
    { key: "content", width: 140 },
    { key: "recrawl", width: 170 },
    { key: "actions", width: 130, fixed: true },
  ] satisfies TableColumnLayout[]);

  /** The Documents this Source stores. The seam still says Concept; ADR-0002. */
  function documentsOf(source: Source): Concept[] {
    return concepts.filter((c) => c.sourceId === source.id);
  }

  // While any source is still crawling, poll the server until it finishes,
  // then refresh so its status/Documents update. The crawl runs on the resolved
  // provider, so this just checks + finalizes, it doesn't hold it open itself.
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
          // transient, try again next tick
        }
      }
      if (settled && !cancelled) router.refresh();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [processingIds, assistantId, collectionId, router]);

  /** Re-crawl a website, or retry a URL list. The row button and the row's
   * context menu both call this rather than each holding a copy. */
  function recrawl(source: Source) {
    startTransition(async () => {
      try {
        if (source.kind === "website") {
          await recrawlSourceAction(source.id);
          ingestionStarted();
          toast.success("Website re-crawled");
        } else {
          await retrySourceIngestAction(assistantId, collectionId, source.id);
          ingestionStarted();
          toast.success("Retry started");
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Retry failed");
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed) {
      toast.error("Please confirm the copyright checkbox first");
      return;
    }
    startTransition(async () => {
      try {
        await addWebsiteSourceAction(assistantId, collectionId, form);
        ingestionStarted();
        toast.success("Crawl started, Documents will appear as they're indexed");
        setForm(websiteFormDefaults(undefined, apifyOrgConnected));
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
            <Badge variant="secondary">
              <RollingNumber value={websiteSources.length} />
            </Badge>
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
              <RollInText text={isPending ? "Starting crawl…" : "Add Website"} />
            </Button>
          </div>
        </form>
      )}

      <TableCard
        footer={
          <TablePagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={websiteSources.length}
            noun="website"
            onPageChange={paged.onPageChange}
            onPageSizeChange={paged.onPageSizeChange}
          />
        }
      >
        <SourceBulkBar
          assistantId={assistantId}
          selection={selection}
          noun="website"
          deleteEffect={(one) =>
            one
              ? "The website and every page crawled from it go."
              : "The websites and every page crawled from them go."
          }
        />
        <Table fixed empty={websiteSources.length === 0}>
          {columns.colGroup}
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SelectAllHead
                state={selection.allState}
                onToggle={selection.toggleAll}
                disabled={websiteSources.length === 0}
              />
              <TableColumnHeader
                label="Name"
                resize={columns.handleFor("name")}
                sort={order.column("name", { asc: "A to Z", desc: "Z to A" })}
                filter={{
                  kind: "text",
                  value: query,
                  placeholder: "Search websites…",
                  onChange: setQuery,
                }}
              />
              <TableColumnHeader
                label="Status"
                resize={columns.handleFor("status")}
                sort={order.column("status", {
                  asc: "Errors first",
                  desc: "Ready first",
                })}
                filter={{
                  kind: "options",
                  value: statusFilter,
                  anyLabel: "Any status",
                  options: SOURCE_STATUS_OPTIONS,
                  onChange: setStatusFilter,
                }}
              />
              <TableColumnHeader
                label="Content"
                resize={columns.handleFor("content")}
                sort={order.column("content", {
                  asc: "Fewest Documents",
                  desc: "Most Documents",
                })}
              />
              <TableColumnHeader
                label="Re-crawl"
                resize={columns.handleFor("recrawl")}
                sort={order.column("recrawl")}
              />
              <TableColumnHeader label="Actions" align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {websiteSources.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="hover:bg-transparent">
                  <EmptyState
                    size="sm"
                    title="No websites yet"
                    description="Add your organization's site to start."
                  />
                </TableCell>
              </TableRow>
            )}
            {paged.items.map((source) => {
              const documentCount = documentsOf(source).length;
              const remove = () =>
                confirmDelete(
                  removeSourceRequest({
                    assistantId,
                    sourceId: source.id,
                    name: source.name,
                    sharedWith: sharedWith[source.id],
                    deleteLabel: "Delete website",
                    deleteEffect: "The website and every page crawled from it go.",
                  })
                );
              return (
                <TableRowMenu
                  key={source.id}
                  title={source.name}
                  onOpen={() => selection.selectForMenu(source.id)}
                  actions={[
                    {
                      label: "Open Documents",
                      icon: Maximize2,
                      href: assistantDocumentsHref(assistantId, source.id),
                    },
                  {
                    label: "Copy ID",
                    icon: Copy,
                    onSelect: () => void copyToClipboard(source.id, "ID copied."),
                  },
                    {
                      label:
                        source.kind === "website"
                          ? "Re-crawl now"
                          : "Retry ingestion",
                      icon: RefreshCw,
                      disabled: isPending || source.status === "processing",
                      onSelect: () => recrawl(source),
                    },
                    {
                      label: "Edit website",
                      icon: Pencil,
                      onSelect: () => setEditing(source),
                    },
                    {
                      label: "Remove from this assistant",
                      icon: Unlink,
                      destructive: true,
                      onSelect: remove,
                    },
                  ]}
                >
                <TableRow
                  data-state={
                    selection.isSelected(source.id) ? "selected" : undefined
                  }
                >
                  <SelectRowCell
                    checked={selection.isSelected(source.id)}
                    onToggle={() => selection.toggle(source.id)}
                    label={source.name}
                  />
                  <TableCell>
                    <TableOpenCell
                      href={assistantDocumentsHref(assistantId, source.id)}
                      label={source.name}
                    >
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
                          className="text-muted-foreground inline-flex max-w-full items-center gap-1 text-xs hover:underline"
                        >
                          {/* truncate needs a block box, so it sits on the text
                              and not on the inline-flex link around it. */}
                          <span className="min-w-0 truncate">{source.config.url}</span>
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                        <span className="text-muted-foreground block text-[0.7rem] capitalize">
                          Crawler: {source.config.crawlerProvider ?? "auto"}
                          {source.config.resolvedCrawlerProvider
                            ? ` · Resolved: ${source.config.resolvedCrawlerProvider}`
                            : ""}
                        </span>
                        {/* A crawl refused for budget (#510) leaves the Source on
                            its previous status, so the reason needs saying here,
                            the status badge alone would look like nothing happened. */}
                        {source.config.crawlBlockedReason ? (
                          <span className="block text-[0.7rem] text-amber-600 dark:text-amber-500">
                            {source.config.crawlBlockedReason}
                          </span>
                        ) : null}
                      </span>
                    )}
                    {/* The reason used to live only in the badge's tooltip,
                        which touch and keyboard never reach. */}
                    {source.status === "error" && source.error && (
                      <p
                        className="text-destructive ml-6 line-clamp-2 text-xs break-words"
                        title={source.error}
                      >
                        {source.error}
                      </p>
                    )}
                    </TableOpenCell>
                  </TableCell>
                  <TableCell>
                    <StatusBadge source={source} />
                    <span
                      className="text-muted-foreground mt-0.5 block text-xs"
                      suppressHydrationWarning
                    >
                      Last update: {formatDateTime(source.updatedAt ?? source.createdAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={assistantDocumentsHref(assistantId, source.id)}
                      className="text-primary press-text text-sm font-semibold hover:underline"
                      title="Open this Source's Documents"
                    >
                      <DocumentCount count={documentCount} />
                    </Link>
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>
                    <TableActions>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={source.kind === "website" ? "Re-crawl website" : "Retry ingestion"}
                        disabled={isPending || source.status === "processing"}
                        onClick={() => recrawl(source)}
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
                      <DeleteSourceButton
                        noun="website"
                        unlinks={(sharedWith[source.id] ?? []).length > 0}
                        onClick={remove}
                      />
                    </TableActions>
                  </TableCell>
                </TableRow>
                </TableRowMenu>
              );
            })}
          </TableBody>
        </Table>
      </TableCard>

      {editing && (
        <WebsiteEditDialog
          key={editing.id}
          assistantId={assistantId}
          source={editing}
          documents={documentsOf(editing)}
          onClose={() => setEditing(null)}
          crawl4aiAvailable={crawl4aiAvailable}
          apifyAvailable={apifyAvailable}
        />
      )}

      {confirmDeleteModal}
    </div>
  );
}

/* ------------------------------ Documents tab ----------------------------- */

function DocumentsTab({
  assistantId,
  collectionId,
  sources,
  sharedWith,
}: {
  assistantId: string;
  collectionId: string;
  sources: Source[];
  sharedWith: Record<string, string[]>;
}) {
  const [query, setQuery] = useState("");
  const [uploads, setUploads] = useState<FileUploadItem[]>([]);
  // Documents used to delete on the first click, with no confirmation at all.
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const [statusFilter, setStatusFilter] = useState("");
  const order = useClientSort();
  const documents = order.sorted(
    tabSources(sources, "files", { query, status: statusFilter }),
    { name: (s) => s.name, status: (s) => s.status }
  );
  const paged = useClientPage(documents);
  const selection = useRowSelection(paged.items.map((s) => s.id));
  const columns = useColumnWidths("assistant-files", [
    { key: "select", width: 44, fixed: true },
    { key: "name", width: 420, min: 200 },
    { key: "status", width: 280 },
    { key: "actions", width: 130, fixed: true },
  ] satisfies TableColumnLayout[]);

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
        // The ingested Source now shows in the documents list below, retire
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
        Upload files for the assistant to answer from.
      </p>
      <FileUpload
        value={uploads}
        onValueChange={setUploads}
        accept=".pdf,.docx,.pptx,.xlsx,.md,.txt,.markdown,.csv"
        title="Drop files here or browse"
        description="PDF, Word, PowerPoint, Excel, Markdown, text, CSV · up to 25 MB"
        onFilesAdded={(added) => {
          for (const item of added) {
            if (item.file) void ingest(item, item.file);
          }
        }}
        onRetry={(item) => {
          if (item.file) void ingest(item, item.file);
        }}
      />

      <TableCard
        footer={
          <TablePagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={documents.length}
            noun="file"
            onPageChange={paged.onPageChange}
            onPageSizeChange={paged.onPageSizeChange}
          />
        }
      >
        <SourceBulkBar
          assistantId={assistantId}
          selection={selection}
          noun="file"
          deleteEffect={(one) =>
            one
              ? "The file and everything indexed from it go."
              : "The files and everything indexed from them go."
          }
        />
        <Table fixed empty={documents.length === 0}>
          {columns.colGroup}
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SelectAllHead
                state={selection.allState}
                onToggle={selection.toggleAll}
                disabled={documents.length === 0}
              />
              <TableColumnHeader
                label="Name"
                resize={columns.handleFor("name")}
                sort={order.column("name", { asc: "A to Z", desc: "Z to A" })}
                filter={{
                  kind: "text",
                  value: query,
                  placeholder: "Search files…",
                  onChange: setQuery,
                }}
              />
              {/* The cell carries the badge and the date, but the column is
                  named Status, so that is what its header orders by: a caret
                  and an `aria-sort` on "Status" over rows in date order say
                  the wrong thing. Same pair of labels as the Websites tab. */}
              <TableColumnHeader
                label="Status"
                resize={columns.handleFor("status")}
                sort={order.column("status", {
                  asc: "Errors first",
                  desc: "Ready first",
                })}
                filter={{
                  kind: "options",
                  value: statusFilter,
                  anyLabel: "Any status",
                  options: SOURCE_STATUS_OPTIONS,
                  onChange: setStatusFilter,
                }}
              />
              <TableColumnHeader label="Actions" align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="hover:bg-transparent">
                  <EmptyState
                    size="sm"
                    title="No files yet"
                    description="Drop one above and it is indexed as it uploads."
                  />
                </TableCell>
              </TableRow>
            )}
            {paged.items.map((source) => {
              const remove = () =>
                confirmDelete(
                  removeSourceRequest({
                    assistantId,
                    sourceId: source.id,
                    name: source.name,
                    sharedWith: sharedWith[source.id],
                    deleteLabel: "Delete document",
                    deleteEffect: "The document and everything indexed from it go.",
                  })
                );
              return (
              <TableRowMenu
                key={source.id}
                title={source.name}
                onOpen={() => selection.selectForMenu(source.id)}
                actions={[
                  {
                    label: "Open Documents",
                    icon: Maximize2,
                    href: assistantDocumentsHref(assistantId, source.id),
                  },
                {
                  label: "Copy ID",
                  icon: Copy,
                  onSelect: () => void copyToClipboard(source.id, "ID copied."),
                },
                  {
                    label: "Remove from this assistant",
                    icon: Unlink,
                    destructive: true,
                    onSelect: remove,
                  },
                ]}
              >
              <TableRow
                data-state={
                  selection.isSelected(source.id) ? "selected" : undefined
                }
              >
                <SelectRowCell
                  checked={selection.isSelected(source.id)}
                  onToggle={() => selection.toggle(source.id)}
                  label={source.name}
                />
                <TableCell>
                  <TableOpenCell
                    href={assistantDocumentsHref(assistantId, source.id)}
                    label={source.name}
                  >
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <Download className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate">{source.name}</span>
                  </span>
                  {source.status === "error" && source.error && (
                    <p
                      className="text-destructive ml-6 line-clamp-2 text-xs break-words"
                      title={source.error}
                    >
                      {source.error}
                    </p>
                  )}
                  </TableOpenCell>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <StatusBadge source={source} />
                    <span className="text-muted-foreground text-xs" suppressHydrationWarning>
                      {formatDateTime(source.createdAt)}
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  <TableActions>
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
                    <DeleteSourceButton
                      noun="document"
                      unlinks={(sharedWith[source.id] ?? []).length > 0}
                      onClick={remove}
                    />
                  </TableActions>
                </TableCell>
              </TableRow>
              </TableRowMenu>
              );
            })}
          </TableBody>
        </Table>
      </TableCard>
      {confirmDeleteModal}
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
    "Original file not stored, re-upload this file to enable re-processing";
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

function DeleteSourceButton({
  noun,
  onClick,
  unlinks,
}: {
  noun: "website" | "document";
  onClick: () => void;
  /**
   * A shared Source is unlinked from this assistant, not deleted, so the
   * button says which of the two it will offer.
   */
  unlinks: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      data-destructive=""
      aria-label={unlinks ? `Remove ${noun} from this assistant` : `Delete ${noun}`}
      onClick={onClick}
    >
      <AnimatedIcon icon={unlinks ? Unlink : Trash2} size={14} />
    </Button>
  );
}

/* -------------------------------- FAQs tab -------------------------------- */

const FAQ_TOOLBAR: Array<
  Array<{ label: string; Icon: typeof Bold; command: MarkdownCommand }>
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
  const initialQuestion = faq?.frontmatter.title ?? "";
  const initialAnswer = faq?.body ?? "";
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState(initialAnswer);
  const [showErrors, setShowErrors] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const questionRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  // Char-granular undo/redo over the answer, like the reference editor.
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);

  const questionMissing = !question.trim();
  const answerMissing = !answer.trim();
  const questionInvalid = showErrors && questionMissing;
  const answerInvalid = showErrors && answerMissing;
  const dirty = question !== initialQuestion || answer !== initialAnswer;

  const { leave } = useUnsavedChanges({
    dirty: open && dirty,
    confirmDelete,
    description: faq
      ? "The edits to this FAQ are not saved yet."
      : "This FAQ has not been added yet.",
  });

  function requestClose() {
    if (isPending) return;
    leave(onClose);
  }

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

  function applyCommand(command: MarkdownCommand) {
    const el = answerRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    setAnswerTracked(applyMarkdownCommand(value, selectionStart, selectionEnd, command));
    requestAnimationFrame(() => el.focus());
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (questionMissing || answerMissing) {
      setShowErrors(true);
      // Land on the first field that needs fixing, not on a silent form.
      (questionMissing ? questionRef : answerRef).current?.focus();
      return;
    }
    startTransition(async () => {
      if (faq) {
        // A FAQ is a Source in the Library, so the per-Assistant tab edits it
        // through the same operation the Library does.
        if (!faq.sourceId) {
          toast.error("This FAQ has no Library entry to update.");
          return;
        }
        try {
          await updateOrgFaqAction(faq.sourceId, question, answer);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not update the FAQ");
          return;
        }
        toast.success("FAQ updated");
      } else {
        try {
          await createFaqAction(assistantId, collectionId, question, answer);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not add the FAQ");
          return;
        }
        toast.success("FAQ added");
      }
      onClose();
    });
  }

  return (
    <>
    {confirmDeleteModal}
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
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
              ref={questionRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, 1000))}
              placeholder="Enter the question or title of your content.."
              autoFocus={!faq && canAutoFocus()}
              aria-invalid={questionInvalid}
              aria-describedby={questionInvalid ? "faq-q-error" : undefined}
              className={
                questionInvalid
                  ? "border-destructive placeholder:text-destructive/70 focus-visible:ring-destructive/30"
                  : undefined
              }
            />
            <div className="flex items-center justify-between text-xs">
              <span id="faq-q-error" className="text-destructive">
                {questionInvalid ? "Question is required" : ""}
              </span>
              <span className="text-muted-foreground">
                <CharCount count={question.length} max={1000} />
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="faq-a">
              Answer <span className="text-destructive">*</span>
            </Label>
            <p className="text-muted-foreground text-xs">We recommend adding at least 100 words</p>
            <div className="rounded-xl border focus-within:border-ring focus-within:ring-ring/50 transition-[border-color,box-shadow] focus-within:ring-3">
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
                aria-invalid={answerInvalid}
                aria-describedby={answerInvalid ? "faq-a-error" : undefined}
                rows={12}
                className="resize-none rounded-t-none border-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span id="faq-a-error" className="text-destructive">
                {answerInvalid ? "Answer is required" : ""}
              </span>
              <span className="text-muted-foreground">
                <CharCount count={answer.length} max={20000} />
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={requestClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="font-semibold">
              <RollInText
                text={isPending ? "Saving…" : faq ? "Save FAQ" : "Add FAQ Knowledge"}
              />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}

/** "12.3 kB": the chosen CSV's size, grouped and unit-labelled by Intl. */
const FILE_SIZE_KB = new Intl.NumberFormat("en-US", {
  style: "unit",
  unit: "kilobyte",
  maximumFractionDigits: 1,
});

/** The "Import FAQs" CSV modal, click-to-upload / drag-drop, two-column contract. */
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
      toast.error("File is too large, the maximum supported size is 10 MB");
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
              ? `Nothing imported, ${skipped[0]}`
              : "Nothing imported, the file has no valid rows"
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
            <p className="mt-4 text-[0.9375rem]">
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
              <p className="mt-3 max-w-full min-w-0 text-sm font-medium break-all">
                {file.name}{" "}
                <span className="text-muted-foreground whitespace-nowrap">
                  ({FILE_SIZE_KB.format(file.size / 1024)})
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
            <RollInText text={isPending ? "Uploading…" : "Upload"} />
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
  sharedWith,
}: {
  assistantId: string;
  collectionId: string;
  faqs: Concept[];
  sharedWith: Record<string, string[]>;
}) {
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Concept | null>(null);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const order = useClientSort();
  const filtered = order.sorted(
    faqs.filter(
      (f) =>
        (f.frontmatter.title ?? "")
          .toLowerCase()
          .includes(query.toLowerCase()) ||
        f.body.toLowerCase().includes(query.toLowerCase())
    ),
    {
      question: (f) => f.frontmatter.title ?? f.path,
      answer: (f) => f.body,
    }
  );
  /**
   * A FAQ owns a `faq` Source (PRD #726), so a FAQ shared with another
   * assistant gets the same remove-or-delete choice; an unshared one keeps
   * the Concept-level delete, which retires its Source anyway. The row
   * button and the row's context menu both call this, and the bulk bar below
   * asks the same question of a whole selection through `bulkRemovalChoice`.
   */
  function removeFaq(faq: Concept) {
    const shared = faq.sourceId ? sharedWith[faq.sourceId] : undefined;
    if (faq.sourceId && shared && shared.length > 0) {
      confirmDelete(
        removeSourceRequest({
          assistantId,
          sourceId: faq.sourceId,
          name: faq.frontmatter.title || "this FAQ",
          sharedWith: shared,
          deleteLabel: "Delete FAQ",
          deleteEffect: "The question and its answer go.",
        })
      );
      return;
    }
    confirmDelete({
      title: "Delete this FAQ?",
      description: `“${faq.frontmatter.title || "This FAQ"}” and its answer go. This cannot be undone.`,
      confirmLabel: "Delete FAQ",
      // Returned, not wrapped in a transition: the modal awaits it to show
      // progress and to toast a failure.
      onConfirm: () => deleteConceptAction(assistantId, faq.id),
    });
  }

  /** Open the FAQ dialog on one FAQ, or on a blank one with `null`. */
  function openFaq(faq: Concept | null) {
    setEditing(faq);
    setDialogOpen(true);
  }

  const paged = useClientPage(filtered);
  const selection = useRowSelection(paged.items.map((f) => f.id));

  /**
   * The ticked rows, and which of their Sources another assistant answers
   * from. The bulk bar needs the second number for the same reason `removeFaq`
   * needs `sharedWith`: deleting a FAQ deletes the Source it owns, for the
   * whole Organization.
   */
  const selected = (() => {
    const ticked = new Set(selection.ids);
    const rows = paged.items.filter((faq) => ticked.has(faq.id));
    const sourceIds = rows
      .map((faq) => faq.sourceId)
      .filter((id): id is string => Boolean(id));
    return {
      ids: rows.map((faq) => faq.id),
      sourceIds,
      sharedCount: sourceIds.filter((id) => (sharedWith[id] ?? []).length > 0)
        .length,
    };
  })();

  const columns = useColumnWidths("assistant-faqs", [
    { key: "select", width: 44, fixed: true },
    { key: "question", width: 340, min: 180 },
    { key: "answer", width: 400, min: 180 },
    { key: "status", width: 200 },
    { key: "actions", width: 110, fixed: true },
  ] satisfies TableColumnLayout[]);

  function exportCsv() {
    const csv = serializeFaqCsv(
      faqs.map((f) => ({
        question: f.frontmatter.title ?? f.path,
        answer: f.body,
      }))
    );
    downloadFile(csv, "text/csv", "faqs.csv");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Questions and Answers
            <Badge variant="secondary">
              <RollingNumber value={faqs.length} />
            </Badge>
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
              <DropdownMenuItem onClick={() => openFaq(null)}>
                <Plus className="size-4" /> Single Q&amp;A
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setImportOpen(true)}>
                <FileUp className="size-4" /> Import FAQs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <TableCard
        footer={
          <TablePagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={filtered.length}
            noun="FAQ"
            pluralNoun="FAQs"
            onPageChange={paged.onPageChange}
            onPageSizeChange={paged.onPageSizeChange}
          />
        }
      >
        <TableBulkBar
          count={selection.count}
          noun="FAQ"
          pluralNoun="FAQs"
          onClear={selection.clear}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const { ids, sourceIds, sharedCount } = selected;
              const one = ids.length === 1;
              const choice = bulkRemovalChoice({
                count: ids.length,
                sharedCount,
                noun: "FAQ",
                pluralNoun: "FAQs",
                deleteLabel: one ? "Delete FAQ" : "Delete FAQs",
                deleteEffect: one
                  ? "The question and its answer go."
                  : "The questions and their answers go.",
              });
              const remove = async () => {
                // Deleting a FAQ Concept retires the `faq` Source it owns, so
                // the org-wide outcome is the Concept delete and the
                // this-assistant-only one is an unlink of those Sources.
                if (choice.mode === "unlink") {
                  await unlinkSourcesAction(assistantId, sourceIds);
                } else {
                  await deleteConceptsAction(assistantId, ids);
                }
                selection.clear();
              };
              confirmDelete({
                title: choice.title,
                description: choice.description,
                confirmLabel: choice.confirmLabel,
                onConfirm: remove,
                secondaryLabel: choice.secondaryLabel,
                onSecondary: choice.secondaryLabel
                  ? async () => {
                      await deleteConceptsAction(assistantId, ids);
                      selection.clear();
                    }
                  : undefined,
              });
            }}
          >
            {selected.sharedCount > 0 ? (
              <Unlink className="mr-1.5 size-4" />
            ) : (
              <Trash2 className="mr-1.5 size-4" />
            )}
            <RollInText text={selected.sharedCount > 0 ? "Remove" : "Delete"} />
          </Button>
        </TableBulkBar>
        <Table fixed empty={filtered.length === 0}>
          {columns.colGroup}
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SelectAllHead
                state={selection.allState}
                onToggle={selection.toggleAll}
                disabled={filtered.length === 0}
              />
              <TableColumnHeader
                label="Question"
                resize={columns.handleFor("question")}
                sort={order.column("question", {
                  asc: "A to Z",
                  desc: "Z to A",
                })}
                filter={{
                  kind: "text",
                  value: query,
                  placeholder: "Search questions and answers…",
                  onChange: setQuery,
                }}
              />
              <TableColumnHeader
                label="Answer"
                resize={columns.handleFor("answer")}
                sort={order.column("answer", { asc: "A to Z", desc: "Z to A" })}
              />
              <TableColumnHeader
                label="Status"
                resize={columns.handleFor("status")}
              />
              <TableColumnHeader label="Actions" align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="hover:bg-transparent">
                  <EmptyState
                    size="sm"
                    title="No FAQs yet"
                    description="Add one to fine-tune answers."
                  />
                </TableCell>
              </TableRow>
            )}
            {paged.items.map((faq) => (
                <TableRowMenu
                  key={faq.id}
                  title={faq.frontmatter.title ?? faq.path}
                  onOpen={() => selection.selectForMenu(faq.id)}
                  actions={[
                    {
                      label: "Edit FAQ",
                      icon: Pencil,
                      onSelect: () => openFaq(faq),
                    },
                    {
                      label: "Copy answer",
                      icon: Copy,
                      onSelect: () => void copyToClipboard(faq.body, "Answer copied."),
                    },
                    {
                      label: "Delete FAQ",
                      icon: Trash2,
                      destructive: true,
                      onSelect: () => removeFaq(faq),
                    },
                  ]}
                >
                <TableRow
                  data-state={
                    selection.isSelected(faq.id) ? "selected" : undefined
                  }
                >
                  <SelectRowCell
                    checked={selection.isSelected(faq.id)}
                    onToggle={() => selection.toggle(faq.id)}
                    label={faq.frontmatter.title ?? faq.path}
                  />
                  <TableCell className="align-top">
                    <span
                      className="block truncate text-sm font-medium"
                      title={faq.frontmatter.title || faq.path}
                    >
                      {faq.frontmatter.title || faq.path}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground align-top">
                    <span className="block truncate text-sm">{faq.body}</span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      {/* Trust tier (OKF §5.3), the FAQ list is where it matters most:
                          an accepted Suggested Fix is agent-drafted but human-reviewed,
                          a hand-typed FAQ is neither. Unverified stays unlabelled, since
                          a badge on every row would carry no signal. */}
                      <TrustTierBadge view={conceptProvenanceView(faq.frontmatter)} />
                      <Badge variant="outline" className="text-muted-foreground gap-1.5 rounded-full bg-muted/40">
                        READY
                      </Badge>
                    </span>
                  </TableCell>
                  <TableCell>
                    <TableActions>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit FAQ"
                        onClick={() => openFaq(faq)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        data-destructive=""
                        aria-label="Delete FAQ"
                        onClick={() => removeFaq(faq)}
                      >
                        <AnimatedIcon icon={Trash2} size={14} />
                      </Button>
                    </TableActions>
                  </TableCell>
                </TableRow>
                </TableRowMenu>
            ))}
          </TableBody>
        </Table>
      </TableCard>
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
      {confirmDeleteModal}
    </div>
  );
}

/* ----------------------------- Concept browser ---------------------------- */

/** A Concept's OKF trust tier; unverified stays unlabelled. */
function TrustTierBadge({ view }: { view: ConceptProvenanceView }) {
  if (view.tier === "unverified") return null;
  return (
    <Badge
      variant={view.tier === "human-reviewed" ? "default" : "secondary"}
      className="shrink-0 rounded-full"
    >
      {view.trustLabel}
    </Badge>
  );
}

/**
 * Provenance timestamps are whatever the producer stamped, usually ISO. A
 * parseable one reads as a date; anything else is shown as written rather
 * than as "Invalid Date".
 */
function readableInstant(value: string): string {
  return Number.isNaN(Date.parse(value)) ? value : formatDateTime(value);
}

function ConceptCard({ assistantId, concept }: { assistantId: string; concept: Concept }) {
  const [open, setOpen] = useState(false);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const provenance = conceptProvenanceView(concept.frontmatter);
  const detailsId = useId();
  return (
    <div className="rounded-xl border">
      {confirmDeleteModal}
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
          <code
            className="text-muted-foreground max-w-[40%] truncate font-mono text-xs"
            title={concept.path}
          >
            {concept.path}
          </code>
          <span className="truncate text-sm font-medium">{concept.frontmatter.title ?? concept.path}</span>
        </button>
        <TrustTierBadge view={provenance} />
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
            confirmDelete({
              title: "Delete this concept?",
              description: `“${concept.frontmatter.title ?? concept.path}” leaves this assistant's knowledge. This cannot be undone.`,
              confirmLabel: "Delete concept",
              onConfirm: () => deleteConceptAction(assistantId, concept.id),
            })
          }
        >
          <AnimatedIcon icon={Trash2} size={14} />
        </Button>
      </div>
      {open && (
        <div id={detailsId} className="border-t px-4 py-3">
          {concept.frontmatter.description && (
            <p className="text-muted-foreground mb-2 text-xs italic">{concept.frontmatter.description}</p>
          )}
          <dl className="text-muted-foreground mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {provenance.generatedBy && (
              <>
                <dt className="font-medium">Generated by</dt>
                <dd className="font-mono break-all">
                  {provenance.generatedBy}
                  {provenance.generatedAt ? ` · ${readableInstant(provenance.generatedAt)}` : ""}
                </dd>
              </>
            )}
            {provenance.verifiedBy && (
              <>
                <dt className="font-medium">Verified by</dt>
                <dd className="font-mono break-all">
                  {provenance.verifiedBy}
                  {provenance.verifiedAt ? ` · ${readableInstant(provenance.verifiedAt)}` : ""}
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
  sharedWith,
  crawl4aiAvailable,
  apifyAvailable,
  apifyOrgConnected,
  nullEmbeddingCount,
  applicationConnections,
  applicationImports,
  applicationOperationalState,
  assistants,
  currentMemberId,
  canEditApplications,
  canManageApplicationConnections,
  applicationOAuthAvailability,
  initialMode = "websites",
}: {
  assistantId: string;
  selected: KnowledgeCollection | null;
  sources: Source[];
  concepts: Concept[];
  /**
   * sourceId → the *other* Assistants that answer from it. Present entries are
   * the shared Sources, where removing here unlinks instead of deleting.
   */
  sharedWith: Record<string, string[]>;
  crawl4aiAvailable: boolean;
  apifyAvailable: boolean;
  /** The Organization connected its own Apify account (Settings → Crawling). */
  apifyOrgConnected: boolean;
  /** Concepts whose chunks miss embeddings (lexical-only until re-embedded). */
  nullEmbeddingCount: number;
  applicationConnections: PublicApplicationConnection[];
  applicationImports: ApplicationImport[];
  applicationOperationalState: Record<
    string,
    { lastRun: ApplicationSyncRun | null; sourceCount: number }
  >;
  assistants: Array<{ id: string; title: string }>;
  currentMemberId: string;
  canEditApplications: boolean;
  canManageApplicationConnections: boolean;
  applicationOAuthAvailability: ApplicationOAuthAvailability;
  /** `?mode=` on the route, so a drill-down's breadcrumb returns to its tab. */
  initialMode?: KnowledgeMode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<KnowledgeMode>(initialMode);
  const [isPending, startTransition] = useTransition();
  const tabsId = useId();
  function reembed() {
    startTransition(async () => {
      try {
        const { pending, reembedded } = await reembedKnowledgeAction(assistantId);
        const noun = (n: number) => `concept${n === 1 ? "" : "s"}`;
        if (reembedded === pending) {
          toast.success(`Re-embedded ${formatCount(reembedded)} ${noun(reembedded)}`);
        } else {
          toast.warning(
            `Re-embedded ${formatCount(reembedded)} of ${formatCount(pending)} ${noun(pending)}`
          );
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Re-embed failed");
      }
    });
  }

  // Ingestion runs off the request path (Ingestion Jobs); poll while any
  // Source is still processing so its status settles without a manual reload.
  const hasProcessing = sources.some((s) => s.status === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [hasProcessing, router]);

  // A FAQ here is one the Library owns: a `faq` Source. The FAQ dialog edits
  // through that Source, so a FAQ-typed Concept under a file or text Source
  // (the retired enricher drafted those) lists with the other Concepts.
  const faqSourceIds = new Set(sources.filter((s) => s.kind === "faq").map((s) => s.id));
  const isFaq = (c: Concept) =>
    c.frontmatter.type === "FAQ" && c.sourceId !== null && faqSourceIds.has(c.sourceId);
  const faqs = concepts.filter(isFaq);
  const nonFaqConcepts = concepts.filter((c) => !isFaq(c));

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
            onClick={reembed}
          >
            <RollInText text={isPending ? "Re-embedding…" : "Re-embed"} />
          </Button>
        </div>
      )}
      {selected ? (
        <>
          {/* The Library's pill rail, so the two knowledge surfaces switch
              tabs the same way. Its arrow-key handling replaces the one this
              component used to carry. Only the active panel renders: the
              rail's own TabsContent keeps every panel mounted, and five
              knowledge tables at once is not a cost worth paying. */}
          <Tabs value={mode} onValueChange={(value) => setMode(value as KnowledgeMode)}>
            <TabsList aria-label="Knowledge types">
              {MODES.map((m) => (
                <TabsTrigger key={m.id} value={m.id}>
                  {m.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div
            role="tabpanel"
            id={`${tabsId}-panel`}
            aria-label={MODES.find((m) => m.id === mode)?.label}
          >
          {mode === "websites" && (
            <WebsitesTab
              assistantId={assistantId}
              collectionId={selected.id}
              sources={sources}
              concepts={concepts}
              sharedWith={sharedWith}
              crawl4aiAvailable={crawl4aiAvailable}
              apifyAvailable={apifyAvailable}
              apifyOrgConnected={apifyOrgConnected}
            />
          )}
          {mode === "documents" && (
            <DocumentsTab
              assistantId={assistantId}
              collectionId={selected.id}
              sources={sources}
              sharedWith={sharedWith}
            />
          )}
          {mode === "applications" && (
            <ApplicationKnowledgePanel
              connections={applicationConnections}
              imports={applicationImports}
              operationalState={applicationOperationalState}
              assistants={assistants}
              currentMemberId={currentMemberId}
              contextAssistantId={assistantId}
              canEdit={canEditApplications}
              canManageConnections={canManageApplicationConnections}
              oauthAvailability={applicationOAuthAvailability}
            />
          )}
          {mode === "faqs" && (
            <FaqsTab
              assistantId={assistantId}
              collectionId={selected.id}
              faqs={faqs}
              sharedWith={sharedWith}
            />
          )}
          {mode === "concepts" && (
            <div className="space-y-2">
              {/* Reader-facing copy: no internal vocabulary, no ADR numbers. */}
              <p className="text-muted-foreground text-sm">
                {formatCount(nonFaqConcepts.length)} concept
                {nonFaqConcepts.length === 1 ? "" : "s"} this assistant can
                cite, each one traceable to the source it came from and to who
                wrote or reviewed it.
              </p>
              {nonFaqConcepts.map((concept) => (
                <ConceptCard key={concept.id} assistantId={assistantId} concept={concept} />
              ))}
            </div>
          )}
          </div>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          Knowledge is being prepared. Refresh in a moment.
        </p>
      )}
    </div>
  );
}
