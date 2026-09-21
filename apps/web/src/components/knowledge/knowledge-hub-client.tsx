"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import type {
  ApplicationImport,
  ApplicationSyncRun,
  OrgKnowledgeSourceListItem,
  SourceStatus,
} from "@agent-hub/core";
import {
  Activity,
  AppWindow,
  Clock,
  Download,
  ExternalLink,
  FileStack,
  FileText,
  Globe,
  KeyRound,
  Link2,
  List,
  MessageCircleQuestion,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import {
  ApplicationKnowledgePanel,
} from "@/components/knowledge/application-knowledge-panel";
import type { PublicApplicationConnection } from "@/lib/application-connections";
import type { ApplicationOAuthAvailability } from "@/lib/application-oauth";
import type { BadgeTone } from "@agent-hub/ui";
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
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteOrgSourceAction,
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
import { EmptyState } from "@/components/ui/empty-state";
import {
  KNOWLEDGE_TAB_LABELS,
  directAccessSummary,
  sourceTypeLabel,
  type HubSearchParams,
  type KnowledgeTabSlug,
} from "@/lib/knowledge-hub";
import { DEFAULT_PAGE_SIZE, paginationRange } from "@/lib/pagination";
import { toast } from "@/lib/toast";

// The dot above stays a solid palette colour: a 6px dot has to carry the state
// on its own and a tint disappears at that size. The badge is the opposite
// case, so it takes a Badge `tone`, which is the same pale-surface /
// dark-ink pair every other status badge in the console now uses.
/** The glyph on the Name column, which names what a row of this tab is. */
const TAB_ROW_ICON: Record<KnowledgeTabSlug, typeof Globe> = {
  websites: Globe,
  files: FileText,
  applications: AppWindow,
  faqs: MessageCircleQuestion,
};

/** What the footer counts. FAQs carry their own plural. */
const TAB_ROW_NOUN: Record<KnowledgeTabSlug, string> = {
  websites: "website",
  files: "file",
  applications: "application",
  faqs: "FAQ",
};
const TAB_ROW_NOUN_PLURAL: Record<KnowledgeTabSlug, string | undefined> = {
  websites: undefined,
  files: undefined,
  applications: undefined,
  faqs: "FAQs",
};

const STATUS_TONE: Record<SourceStatus, BadgeTone> = {
  ready: "green",
  processing: "amber",
  error: "red",
};

function formatWhen(iso: string): string {
  if (!iso) return "—";
  // The explicit-locale, UTC formatter: `toLocaleString(undefined, …)` took the
  // server's locale and zone on the server and the reader's in the browser, so
  // every dated row hydrated to different text (React #418) on the Library.
  return formatDateTime(iso);
}

function StatusBadge({ status }: { status: SourceStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} className="text-2xs uppercase">
      {status}
    </Badge>
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

export function KnowledgeHubClient({
  tab,
  filters,
  items,
  total,
  pageSize,
  assistants,
  currentMemberId,
  canEdit,
  applicationConnections,
  applicationImports,
  applicationOperationalState,
  canManageConnections,
  applicationOAuthAvailability,
}: {
  tab: KnowledgeTabSlug;
  filters: HubSearchParams;
  items: OrgKnowledgeSourceListItem[];
  total: number;
  pageSize: number;
  assistants: Array<{ id: string; title: string }>;
  currentMemberId: string;
  canEdit: boolean;
  applicationConnections: PublicApplicationConnection[];
  applicationImports: ApplicationImport[];
  applicationOperationalState: Record<
    string,
    { lastRun: ApplicationSyncRun | null; sourceCount: number }
  >;
  canManageConnections: boolean;
  applicationOAuthAvailability: ApplicationOAuthAvailability;
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
    if (next.size !== DEFAULT_PAGE_SIZE) params.set("size", String(next.size));
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

  function downloadOriginal(item: OrgKnowledgeSourceListItem) {
    // The route streams the bytes and records the transfer (#801, CYB-05); a
    // signed URL handed to the browser recorded nothing and outlived the click.
    window.open(
      `/api/knowledge/originals/${encodeURIComponent(item.id)}`,
      "_blank",
      "noopener"
    );
  }

  // The heading and the tab rail belong to `library/layout.tsx`, which outlives
  // the `[tab]` segment; this component is the bucket's own content.
  return (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
        {tab === "applications" && (
          <ApplicationKnowledgePanel
            connections={applicationConnections}
            imports={applicationImports}
            operationalState={applicationOperationalState}
            assistants={assistants}
            currentMemberId={currentMemberId}
            canEdit={canEdit}
            canManageConnections={canManageConnections}
            oauthAvailability={applicationOAuthAvailability}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72">
            <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${KNOWLEDGE_TAB_LABELS[tab].toLowerCase()}...`}
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
            {canEdit && tab !== "applications" && (
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

        <TableCard
          className={isPending ? "opacity-60" : undefined}
          footer={
            <TablePagination
              page={filters.page}
              pageSize={pageSize}
              total={total}
              noun={TAB_ROW_NOUN[tab]}
              pluralNoun={TAB_ROW_NOUN_PLURAL[tab]}
              onPageChange={(page) => apply({ page })}
              onPageSizeChange={(size) => apply({ size, page: 1 })}
            />
          }
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {tab === "faqs" ? (
                  <>
                    <TableHead icon={MessageCircleQuestion} className="min-w-64">
                      Question
                    </TableHead>
                    <TableHead icon={MessageSquare} className="min-w-64">
                      Answer
                    </TableHead>
                  </>
                ) : (
                  <TableHead icon={TAB_ROW_ICON[tab]} className="min-w-64">
                    Name
                  </TableHead>
                )}
                {tab === "websites" && (
                  <TableHead icon={FileStack}>Content</TableHead>
                )}
                <TableHead icon={Link2}>Linked assistants</TableHead>
                {tab === "files" && (
                  <TableHead icon={KeyRound}>Direct access</TableHead>
                )}
                {/* Status, where "Created at" used to be. When a row was first
                    added answers nothing anyone asks of this table; whether it
                    is answering questions yet is the whole question, and a
                    crawling website had no status column at all. */}
                <TableHead icon={Activity}>Status</TableHead>
                <TableHead icon={Clock}>Last updated at</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  {/* The mark rather than a sentence in a 24px-tall cell: an
                      empty tab is the same fact the rest of the console draws
                      the same way. `hover:bg-transparent` because there is no
                      row here to highlight. */}
                  <TableCell colSpan={6} className="hover:bg-transparent">
                    <EmptyState size="sm" title="Nothing here yet" />
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
                        ) : item.kind === "application" ? (
                          <AppWindow className="text-muted-foreground mt-0.5 size-4 shrink-0" />
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
                          {tab === "applications" && item.config.remoteUrl && (
                            <a
                              href={item.config.remoteUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                            >
                              Open in source application
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
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {formatWhen(item.updatedAt)}
                  </TableCell>
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
        </TableCard>
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
    </>
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
              <TableRow className="hover:bg-transparent">
                <TableHead icon={FileText}>Name</TableHead>
                <TableHead icon={Link2}>Link</TableHead>
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
