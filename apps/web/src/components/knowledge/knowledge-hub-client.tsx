"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { OrgKnowledgeSourceListItem, SourceStatus } from "@agent-hub/core";
import type { OrgKnowledgeStatusCounts } from "@agent-hub/core";
import {
  Download,
  ExternalLink,
  FileText,
  Globe,
  Link2,
  List,
  MessageCircleQuestion,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@agent-hub/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteOrgSourceAction,
  downloadKnowledgeOriginalAction,
  exportOrgFaqsAction,
  listSourceConceptsAction,
} from "@/app/actions";
import {
  AddFileDialog,
  AddWebsiteDialog,
  FaqDialog,
  ImportFaqsDialog,
  LinkAssistantsDialog,
  ManageDirectAccessDialog,
} from "@/components/knowledge/knowledge-hub-dialogs";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import {
  KNOWLEDGE_TAB_SLUGS,
  directAccessSummary,
  sourceTypeLabel,
  tabHealth,
  type HubSearchParams,
  type KnowledgeTabSlug,
} from "@/lib/knowledge-hub";
import { paginationRange } from "@/lib/pagination";
import { toast } from "@/lib/toast";

const TAB_LABELS: Record<KnowledgeTabSlug, string> = {
  websites: "Websites",
  files: "Files",
  faqs: "FAQs",
};

const TAB_TITLES: Record<KnowledgeTabSlug, string> = {
  websites: "Websites",
  files: "Files",
  faqs: "Questions and Answers",
};

const TAB_INTROS: Record<KnowledgeTabSlug, string> = {
  websites:
    "Add your organization's main website, or links to additional knowledge bases linked assistants should reference when answering questions.",
  files:
    "Upload files to add to your organization's knowledge base. Linked assistants will use these to answer questions.",
  faqs: "Add sets of questions and answers to fine tune AI responses.",
};

const HEALTH_DOT: Record<SourceStatus, string> = {
  ready: "bg-emerald-500",
  processing: "bg-amber-500",
  error: "bg-red-500",
};

const STATUS_BADGE: Record<SourceStatus, string> = {
  ready:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  processing:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  error:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400",
};

function formatWhen(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: SourceStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase ${STATUS_BADGE[status]}`}
    >
      {status}
    </span>
  );
}

function LinkedAssistantChips({
  item,
}: {
  item: OrgKnowledgeSourceListItem;
}) {
  const links = item.linkedAssistants;
  if (links.length === 0)
    return <span className="text-muted-foreground text-sm">Not linked</span>;
  const [first, ...rest] = links;
  return (
    <span className="flex items-center gap-1.5">
      <Badge variant="outline" className="max-w-44 truncate font-normal">
        {first.assistantName || first.assistantId}
      </Badge>
      {rest.length > 0 && (
        <Badge
          variant="outline"
          className="font-normal"
          title={rest.map((l) => l.assistantName || l.assistantId).join(", ")}
        >
          +{rest.length}
        </Badge>
      )}
    </span>
  );
}

interface TabSummary {
  total: number;
  statusCounts: OrgKnowledgeStatusCounts;
}

export function KnowledgeHubClient({
  tab,
  filters,
  items,
  total,
  pageSize,
  tabSummaries,
  assistants,
  canEdit,
}: {
  tab: KnowledgeTabSlug;
  filters: HubSearchParams;
  items: OrgKnowledgeSourceListItem[];
  total: number;
  pageSize: number;
  tabSummaries: Record<string, TabSummary>;
  assistants: Array<{ id: string; title: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(filters.q);
  const [viewing, setViewing] = useState<OrgKnowledgeSourceListItem | null>(
    null
  );
  const [linking, setLinking] = useState<OrgKnowledgeSourceListItem | null>(
    null
  );
  const [editingFaq, setEditingFaq] =
    useState<OrgKnowledgeSourceListItem | null>(null);
  const [managingAccess, setManagingAccess] =
    useState<OrgKnowledgeSourceListItem | null>(null);
  const [adding, setAdding] = useState<"website" | "file" | "faq" | "faq-import" | null>(
    null
  );
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const [isPending, startTransition] = useTransition();

  const apply = (patch: Partial<HubSearchParams>) => {
    const next = { ...filters, q: query, ...patch };
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.status) params.set("status", next.status);
    if (next.assistant) params.set("assistant", next.assistant);
    if (next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  // Debounced free-text search → the `q` URL param (server-side filtering).
  useEffect(() => {
    if (query === filters.q) return;
    const handle = setTimeout(() => apply({ q: query, page: 1 }), 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function exportFaqs() {
    const { csv } = await exportOrgFaqsAction();
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "faqs.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function downloadOriginal(item: OrgKnowledgeSourceListItem) {
    const { url } = await downloadKnowledgeOriginalAction(item.id);
    if (!url) {
      toast.error("No stored original is available for this file.");
      return;
    }
    window.open(url, "_blank", "noopener");
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          {TAB_TITLES[tab]}
          <Badge variant="secondary">{tabSummaries[tab]?.total ?? 0}</Badge>
        </h1>
      </header>
      <p className="text-muted-foreground max-w-3xl px-4 text-sm sm:px-6">
        {TAB_INTROS[tab]}
      </p>

      <nav
        className="border-border mt-4 flex shrink-0 items-center gap-1 border-b px-4 sm:px-6"
        aria-label="Library tabs"
      >
        {KNOWLEDGE_TAB_SLUGS.map((slug) => {
          const summary = tabSummaries[slug];
          const health = summary ? tabHealth(summary.statusCounts) : null;
          const active = slug === tab;
          return (
            <Link
              key={slug}
              href={`/library/${slug}`}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-primary text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              }`}
            >
              {TAB_LABELS[slug]}
              <span className="text-muted-foreground text-xs">
                {summary?.total ?? 0}
              </span>
              {health && (
                <span
                  className={`size-1.5 rounded-full ${HEALTH_DOT[health]}`}
                  aria-label={`status: ${health}`}
                />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${TAB_LABELS[tab].toLowerCase()}...`}
              className="pl-8"
            />
          </div>
          <Select
            value={filters.status}
            onValueChange={(v) =>
              apply({ status: (v ?? "") as "" | SourceStatus, page: 1 })
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Any status</SelectItem>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filters.assistant}
            onValueChange={(v) => apply({ assistant: (v ?? "") as string, page: 1 })}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Filter by assistant" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All assistants</SelectItem>
              {assistants.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            {tab === "faqs" && (
              <Button variant="outline" size="sm" onClick={exportFaqs}>
                <Download className="mr-1.5 size-4" /> Export
              </Button>
            )}
            {canEdit && tab === "faqs" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdding("faq-import")}
              >
                <Upload className="mr-1.5 size-4" /> Import
              </Button>
            )}
            {canEdit && (
              <Button
                size="sm"
                onClick={() =>
                  setAdding(
                    tab === "websites" ? "website" : tab === "files" ? "file" : "faq"
                  )
                }
              >
                <Plus className="mr-1.5 size-4" /> Add
              </Button>
            )}
          </div>
        </div>

        <div
            className={`overflow-x-auto rounded-xl border ${isPending ? "opacity-60" : ""}`}
        >
          <Table>
            <TableHeader>
              <TableRow>
                {tab === "faqs" ? (
                  <>
                    <TableHead className="min-w-64">Question</TableHead>
                    <TableHead className="min-w-64">Answer</TableHead>
                  </>
                ) : (
                  <TableHead className="min-w-64">Name</TableHead>
                )}
                {tab === "websites" && <TableHead>Content</TableHead>}
                <TableHead>Linked assistants</TableHead>
                {tab === "files" && <TableHead>Direct access</TableHead>}
                <TableHead>Created at</TableHead>
                <TableHead>Last updated at</TableHead>
                {tab !== "websites" && <TableHead>Status</TableHead>}
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-muted-foreground h-24 text-center"
                  >
                    Nothing here yet.
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => (
                <TableRow key={item.id}>
                  {tab === "faqs" ? (
                    <>
                      <TableCell className="max-w-80 align-top font-medium whitespace-normal">
                        {item.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-96 align-top whitespace-normal">
                        <span className="line-clamp-2">
                          {item.answerPreview || "—"}
                        </span>
                      </TableCell>
                    </>
                  ) : (
                    <TableCell className="max-w-96">
                      <span className="flex items-start gap-2">
                        {item.kind === "website" ? (
                          <Globe className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        ) : item.kind === "url" ? (
                          <List className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        ) : item.kind === "faq" ? (
                          <MessageCircleQuestion className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        ) : (
                          <FileText className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {item.name}
                          </span>
                          {tab === "websites" && item.config.url && (
                            <a
                              href={item.config.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                            >
                              <span className="max-w-72 truncate">
                                {item.config.url}
                              </span>
                              <ExternalLink className="size-3 shrink-0" />
                            </a>
                          )}
                        </span>
                      </span>
                    </TableCell>
                  )}
                  {tab === "websites" && (
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setViewing(item)}
                        className="text-primary font-medium hover:underline"
                      >
                        {item.conceptCount}{" "}
                        {item.conceptCount === 1 ? "Page" : "Pages"}
                      </button>
                    </TableCell>
                  )}
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <LinkedAssistantChips item={item} />
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          title="Manage linked assistants"
                          onClick={() => setLinking(item)}
                        >
                          <Link2 className="size-3.5" />
                        </Button>
                      )}
                    </span>
                  </TableCell>
                  {tab === "files" && (
                    <TableCell className="text-muted-foreground text-sm">
                      <span className="flex items-center gap-1.5">
                        {directAccessSummary(item.linkedAssistants)}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title={
                              item.originalObjectPath
                                ? "Manage direct access"
                                : "No stored original, direct access unavailable"
                            }
                            onClick={() => setManagingAccess(item)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  )}
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {formatWhen(item.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {formatWhen(item.updatedAt)}
                  </TableCell>
                  {tab !== "websites" && (
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                  )}
                  <TableCell>
                    <span className="flex justify-end gap-1">
                      {tab === "files" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={
                            item.originalObjectPath
                              ? "Download original"
                              : "No stored original"
                          }
                          disabled={!item.originalObjectPath}
                          onClick={() => downloadOriginal(item)}
                        >
                          <Download className="size-4" />
                        </Button>
                      )}
                      {canEdit && (
                        <>
                          {tab === "faqs" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Edit FAQ"
                              onClick={() => setEditingFaq(item)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            onClick={() =>
                              confirmDelete({
                                title: `Delete “${item.name}”?`,
                                description:
                                  "This removes it for every linked assistant at once, including its indexed content.",
                                onConfirm: async () => {
                                  await deleteOrgSourceAction(item.id);
                                  toast.success("Deleted.");
                                  router.refresh();
                                },
                              })
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-1">
            {paginationRange(filters.page, pageCount).map((entry, i) =>
              entry === "ellipsis" ? (
                <span key={`e-${i}`} className="text-muted-foreground px-2">
                  …
                </span>
              ) : (
                <Button
                  key={entry}
                  variant={entry === filters.page ? "default" : "outline"}
                  size="sm"
                  onClick={() => apply({ page: entry })}
                >
                  {entry}
                </Button>
              )
            )}
          </div>
        )}
      </div>

      {/* Keyed by item so every open starts from fresh state. */}
      <ViewSourceDialog
        key={viewing?.id ?? "closed"}
        item={viewing}
        onClose={() => setViewing(null)}
      />
      <LinkAssistantsDialog
        key={`link-${linking?.id ?? "closed"}`}
        item={linking}
        assistants={assistants}
        onClose={() => setLinking(null)}
      />
      <ManageDirectAccessDialog
        key={`access-${managingAccess?.id ?? "closed"}`}
        item={managingAccess}
        onClose={() => setManagingAccess(null)}
      />
      <AddWebsiteDialog
        open={adding === "website"}
        assistants={assistants}
        onClose={() => setAdding(null)}
      />
      <AddFileDialog
        open={adding === "file"}
        assistants={assistants}
        onClose={() => setAdding(null)}
      />
      <FaqDialog
        key={`faq-${editingFaq?.id ?? "new"}-${adding === "faq"}`}
        open={adding === "faq" || editingFaq !== null}
        editing={editingFaq}
        assistants={assistants}
        onClose={() => {
          setAdding(null);
          setEditingFaq(null);
        }}
      />
      <ImportFaqsDialog
        open={adding === "faq-import"}
        assistants={assistants}
        onClose={() => setAdding(null)}
      />
      {confirmDeleteModal}
    </div>
  );
}

/**
 * The "View knowledge source" modal: type badge, page count, KB URL, and a
 * searchable pages list (bounded server-side; searched and paged locally).
 */
function ViewSourceDialog({
  item,
  onClose,
}: {
  item: OrgKnowledgeSourceListItem | null;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<
    Array<{ id: string; title: string; path: string; resourceUrl: string | null }>
  >([]);
  // The dialog is remounted per item (keyed by the parent), so initial state
  // is already fresh, the effect only fetches.
  const [loading, setLoading] = useState(item !== null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 8;

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    listSourceConceptsAction(item.id)
      .then((r) => {
        if (!cancelled) setPages(r.items);
      })
      .catch(() => toast.error("Could not load this source's pages."))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  const filtered = useMemo(
    () =>
      pages.filter(
        (p) =>
          p.title.toLowerCase().includes(query.toLowerCase()) ||
          (p.resourceUrl ?? "").toLowerCase().includes(query.toLowerCase())
      ),
    [pages, query]
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>View knowledge source: {item?.name}</DialogTitle>
          <DialogDescription>
            The pages indexed under this knowledge source.
          </DialogDescription>
        </DialogHeader>
        <div className="text-muted-foreground flex items-center gap-3 text-sm">
          {item && (
            <Badge variant="outline">{sourceTypeLabel(item.kind)}</Badge>
          )}
          <span>
            {item?.conceptCount} {item?.conceptCount === 1 ? "Page" : "Pages"}
          </span>
          {item?.config.url && (
            <a
              href={item.config.url}
              target="_blank"
              rel="noreferrer"
              className="text-primary max-w-72 truncate hover:underline"
            >
              {item.config.url}
            </a>
          )}
        </div>
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search"
        />
        <div className="max-h-80 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Link</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell
                    colSpan={2}
                    className="text-muted-foreground h-16 text-center"
                  >
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!loading && slice.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={2}
                    className="text-muted-foreground h-16 text-center"
                  >
                    No pages found.
                  </TableCell>
                </TableRow>
              )}
              {slice.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-64 whitespace-normal">
                    <span className="line-clamp-2">{p.title}</span>
                  </TableCell>
                  <TableCell className="max-w-72">
                    {p.resourceUrl ? (
                      <a
                        href={p.resourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary block truncate hover:underline"
                      >
                        {p.resourceUrl}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{p.path}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-1">
            {paginationRange(page, pageCount).map((entry, i) =>
              entry === "ellipsis" ? (
                <span key={`e-${i}`} className="text-muted-foreground px-2">
                  …
                </span>
              ) : (
                <Button
                  key={entry}
                  variant={entry === page ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPage(entry)}
                >
                  {entry}
                </Button>
              )
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
