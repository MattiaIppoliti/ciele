"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import type {
  ApplicationImport,
  ApplicationSyncRun,
  OrgKnowledgeSourceListItem,
  SourceStatus,
} from "@agent-hub/core";
import {
  AppWindow,
  Copy,
  Maximize2,
  Download,
  Brain,
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
  ApplicationKnowledgePanel,
} from "@/components/knowledge/application-knowledge-panel";
import type { PublicApplicationConnection } from "@/lib/application-connections";
import type { ApplicationOAuthAvailability } from "@/lib/application-oauth";
import type { BadgeTone } from "@agent-hub/ui";
import {
  Badge,
  Button,
  Input,
} from "@agent-hub/ui";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableActions,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableColumnHeader } from "@/components/ui/table-column-header";
import {
  useColumnWidths,
  type TableColumnLayout,
} from "@/components/ui/table-columns";
import { TableOpenCell } from "@/components/ui/table-open-cell";
import { TableRowMenu } from "@/components/ui/table-menu";
import { TablePagination } from "@/components/ui/table-pagination";
import {
  SelectAllHead,
  SelectRowCell,
  TableBulkBar,
  useRowSelection,
} from "@/components/ui/table-selection";
import {
  deleteOrgSourceAction,
  deleteOrgSourcesAction,
  exportOrgFaqsAction,
  extractSourceMemoriesAction,
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
  type HubSearchParams,
  type KnowledgeTabSlug,
} from "@/lib/knowledge-hub";
import { libraryDocumentsHref } from "@/lib/source-documents";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { toast } from "@/lib/toast";

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
  const [linking, setLinking] = useState<OrgKnowledgeSourceListItem | null>(
    null
  );
  /** Rows whose backfill has been asked for, so a second click is inert. */
  const [extracting, setExtracting] = useState<Set<string>>(new Set());
  const [editingFaq, setEditingFaq] =
    useState<OrgKnowledgeSourceListItem | null>(null);
  const [managingAccess, setManagingAccess] =
    useState<OrgKnowledgeSourceListItem | null>(null);
  const [adding, setAdding] = useState<"website" | "file" | "faq" | "faq-import" | null>(
    null
  );
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const [isPending, startTransition] = useTransition();
  const selection = useRowSelection(items.map((item) => item.id));
  /** The table is paged on the server, so sort and filter live in the URL. */
  const direction = filters.ascending ? "asc" : "desc";

  function confirmRowDelete(item: OrgKnowledgeSourceListItem) {
    confirmDelete({
      title: `Delete “${item.name}”?`,
      description:
        "This removes it for every linked assistant at once, including its indexed content.",
      onConfirm: async () => {
        await deleteOrgSourceAction(item.id);
        toast.success("Deleted.");
      },
    });
  }

  function extractRowMemories(item: OrgKnowledgeSourceListItem) {
    startTransition(async () => {
      setExtracting((current) => new Set(current).add(item.id));
      try {
        const { queued } = await extractSourceMemoriesAction(item.id);
        toast.success(
          queued === 0
            ? "Nothing to extract: every Document is up to date or already queued."
            : `Extracting memories for ${queued} ${
                queued === 1 ? "Document" : "Documents"
              }.`
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not start extraction"
        );
      }
    });
  }

  // The columns differ per tab, and so does what a reader chose to widen, so
  // the remembered layout is keyed by tab rather than by "the Library".
  const layout: TableColumnLayout[] = [
    ...(canEdit
      ? [{ key: "select", width: 44, fixed: true } as TableColumnLayout]
      : []),
    { key: "name", width: tab === "faqs" ? 320 : 380, min: 180 },
    ...(tab === "faqs"
      ? [{ key: "answer", width: 360, min: 160 } as TableColumnLayout]
      : []),
    ...(tab === "websites"
      ? [{ key: "content", width: 140 } as TableColumnLayout]
      : []),
    { key: "linked", width: 220, min: 120 },
    ...(tab === "files"
      ? [{ key: "access", width: 170 } as TableColumnLayout]
      : []),
    { key: "status", width: 130 },
    { key: "updated", width: 190 },
    { key: "actions", width: 150, fixed: true },
  ];
  const columns = useColumnWidths(`library-${tab}`, layout);

  /**
   * How wide the empty row has to be. Counted rather than written down,
   * because the columns are conditional on the tab and the reader's Role and
   * a stale number leaves the mark hanging under the first column.
   */
  const columnCount =
    (canEdit ? 1 : 0) +
    (tab === "faqs" ? 2 : 1) +
    (tab === "websites" ? 1 : 0) +
    (tab === "files" ? 1 : 0) +
    4;

  const apply = (patch: Partial<HubSearchParams>) => {
    const next = { ...filters, q: query, ...patch };
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.status) params.set("status", next.status);
    if (next.assistant) params.set("assistant", next.assistant);
    if (next.page > 1) params.set("page", String(next.page));
    if (next.size !== DEFAULT_PAGE_SIZE) params.set("size", String(next.size));
    if (next.sort) params.set("sort", next.sort);
    if (next.ascending) params.set("dir", "asc");
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

  // The heading and the tab rail belong to `library/(hub)/layout.tsx`, which outlives
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
          <TableBulkBar
            count={selection.count}
            noun={TAB_ROW_NOUN[tab]}
            pluralNoun={TAB_ROW_NOUN_PLURAL[tab]}
            onClear={selection.clear}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => {
                const ids = selection.ids;
                const one = ids.length === 1;
                confirmDelete({
                  title: `Delete ${ids.length} ${
                    one
                      ? TAB_ROW_NOUN[tab]
                      : (TAB_ROW_NOUN_PLURAL[tab] ?? `${TAB_ROW_NOUN[tab]}s`)
                  }?`,
                  description: one
                    ? "This removes it for every linked assistant at once, including its indexed content."
                    : "This removes them for every linked assistant at once, including their indexed content.",
                  onConfirm: async () => {
                    await deleteOrgSourcesAction(ids);
                    selection.clear();
                    toast.success("Deleted.");
                  },
                });
              }}
            >
              <Trash2 className="mr-1.5 size-4" /> Delete
            </Button>
          </TableBulkBar>

          <Table fixed empty={items.length === 0}>
            {columns.colGroup}
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {canEdit && (
                  <SelectAllHead
                    state={selection.allState}
                    onToggle={selection.toggleAll}
                    disabled={items.length === 0}
                  />
                )}
                <TableColumnHeader
                  label={tab === "faqs" ? "Question" : "Name"}
                  resize={columns.handleFor("name")}
                  sort={{
                    direction: filters.sort === "name" ? direction : null,
                    ascLabel: "A to Z",
                    descLabel: "Z to A",
                    onSort: (next) =>
                      apply({ sort: "name", ascending: next === "asc", page: 1 }),
                    onClear: () => apply({ sort: "", page: 1 }),
                  }}
                  filter={{
                    kind: "text",
                    value: query,
                    placeholder: `Search ${KNOWLEDGE_TAB_LABELS[
                      tab
                    ].toLowerCase()}…`,
                    onChange: setQuery,
                  }}
                />
                {tab === "faqs" && (
                  <TableColumnHeader
                    label="Answer"
                    resize={columns.handleFor("answer")}
                  />
                )}
                {tab === "websites" && (
                  <TableColumnHeader
                    label="Content"
                    resize={columns.handleFor("content")}
                  />
                )}
                <TableColumnHeader
                  label="Linked assistants"
                  resize={columns.handleFor("linked")}
                  filter={{
                    kind: "options",
                    value: filters.assistant,
                    anyLabel: "All assistants",
                    options: assistants.map((a) => ({
                      value: a.id,
                      label: a.title,
                    })),
                    onChange: (value) => apply({ assistant: value, page: 1 }),
                  }}
                />
                {tab === "files" && (
                  <TableColumnHeader
                    label="Direct access"
                    resize={columns.handleFor("access")}
                  />
                )}
                {/* Status, where "Created at" used to be. When a row was first
                    added answers nothing anyone asks of this table; whether it
                    is answering questions yet is the whole question, and a
                    crawling website had no status column at all. */}
                <TableColumnHeader
                  label="Status"
                  resize={columns.handleFor("status")}
                  sort={{
                    direction: filters.sort === "status" ? direction : null,
                    ascLabel: "Errors first",
                    descLabel: "Ready first",
                    onSort: (next) =>
                      apply({ sort: "status", ascending: next === "asc", page: 1 }),
                    onClear: () => apply({ sort: "", page: 1 }),
                  }}
                  filter={{
                    kind: "options",
                    value: filters.status,
                    anyLabel: "Any status",
                    options: [
                      { value: "ready", label: "Ready" },
                      { value: "processing", label: "Processing" },
                      { value: "error", label: "Error" },
                    ],
                    onChange: (value) =>
                      apply({ status: value as "" | SourceStatus, page: 1 }),
                  }}
                />
                <TableColumnHeader
                  label="Last updated at"
                  resize={columns.handleFor("updated")}
                  sort={{
                    direction: filters.sort === "updatedAt" ? direction : null,
                    ascLabel: "Oldest first",
                    descLabel: "Newest first",
                    onSort: (next) =>
                      apply({
                        sort: "updatedAt",
                        ascending: next === "asc",
                        page: 1,
                      }),
                    onClear: () => apply({ sort: "", page: 1 }),
                  }}
                />
                {/* Named, rather than the blank cell it was: a column of
                    controls with no heading reads as an overflow of the one
                    before it. */}
                <TableColumnHeader label="Actions" align="right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  {/* The mark rather than a sentence in a 24px-tall cell: an
                      empty tab is the same fact the rest of the console draws
                      the same way. `hover:bg-transparent` because there is no
                      row here to highlight. */}
                  <TableCell
                    colSpan={columnCount}
                    className="hover:bg-transparent"
                  >
                    <EmptyState size="sm" title="Nothing here yet" />
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => (
                <TableRowMenu
                  key={item.id}
                  title={item.name}
                  onOpen={
                    canEdit ? () => selection.selectForMenu(item.id) : undefined
                  }
                  actions={[
                    {
                      label: "Open",
                      icon: Maximize2,
                      href: libraryDocumentsHref(item.kind, item.id),
                    },
                    {
                      label: "Copy ID",
                      icon: Copy,
                      onSelect: () => {
                        void navigator.clipboard?.writeText(item.id);
                        toast.success("ID copied.");
                      },
                    },
                    canEdit && {
                      label: "Manage linked assistants",
                      icon: Link2,
                      onSelect: () => setLinking(item),
                    },
                    canEdit &&
                      tab === "files" && {
                        label: "Manage direct access",
                        icon: Pencil,
                        disabled: !item.originalObjectPath,
                        onSelect: () => setManagingAccess(item),
                      },
                    tab === "files" && {
                      label: "Download original",
                      icon: Download,
                      disabled: !item.originalObjectPath,
                      onSelect: () => downloadOriginal(item),
                    },
                    canEdit &&
                      tab === "faqs" && {
                        label: "Edit FAQ",
                        icon: Pencil,
                        onSelect: () => setEditingFaq(item),
                      },
                    canEdit && {
                      label: "Extract memories",
                      icon: Brain,
                      disabled: extracting.has(item.id),
                      onSelect: () => extractRowMemories(item),
                    },
                    canEdit && {
                      label: "Delete",
                      icon: Trash2,
                      destructive: true,
                      onSelect: () => confirmRowDelete(item),
                    },
                  ]}
                >
                <TableRow
                  data-state={
                    selection.isSelected(item.id) ? "selected" : undefined
                  }
                >
                  {canEdit && (
                    <SelectRowCell
                      checked={selection.isSelected(item.id)}
                      onToggle={() => selection.toggle(item.id)}
                      label={item.name}
                    />
                  )}
                  {tab === "faqs" ? (
                    <>
                      <TableCell className="align-top font-medium">
                        <TableOpenCell
                          href={libraryDocumentsHref(item.kind, item.id)}
                          label={item.name}
                        >
                          <span className="block truncate">{item.name}</span>
                        </TableOpenCell>
                      </TableCell>
                      <TableCell className="text-muted-foreground align-top">
                        <span className="block truncate">
                          {item.answerPreview || "—"}
                        </span>
                      </TableCell>
                    </>
                  ) : (
                    <TableCell>
                      <TableOpenCell
                        href={libraryDocumentsHref(item.kind, item.id)}
                        label={item.name}
                        className="flex items-start gap-2"
                      >
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
                          <Link
                            href={libraryDocumentsHref(item.kind, item.id)}
                            className="press-text block truncate font-medium hover:underline"
                          >
                            {item.name}
                          </Link>
                          {tab === "websites" && item.config.url && (
                            <a
                              href={item.config.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                            >
                              <span className="truncate">
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
                      </TableOpenCell>
                    </TableCell>
                  )}
                  {tab === "websites" && (
                    <TableCell>
                      <Link
                        href={libraryDocumentsHref(item.kind, item.id)}
                        className="text-primary press-text font-medium hover:underline"
                      >
                        {item.conceptCount}{" "}
                        {item.conceptCount === 1 ? "Document" : "Documents"}
                      </Link>
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
                    <TableActions>
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
                          {/* The memories backfill (#933), on the row rather
                              than only inside the Source: an admin catching up
                              a whole Library should not have to open each one. */}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Extract memories"
                            disabled={extracting.has(item.id)}
                            onClick={() =>
                              startTransition(async () => {
                                setExtracting((current) =>
                                  new Set(current).add(item.id)
                                );
                                try {
                                  const { queued } =
                                    await extractSourceMemoriesAction(item.id);
                                  toast.success(
                                    queued === 0
                                      ? "Nothing to extract: every Document is up to date or already queued."
                                      : `Extracting memories for ${queued} ${
                                          queued === 1 ? "Document" : "Documents"
                                        }.`
                                  );
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Could not start extraction"
                                  );
                                }
                              })
                            }
                          >
                            <Brain className="size-4" />
                          </Button>
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
                            data-destructive=""
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
                    </TableActions>
                  </TableCell>
                </TableRow>
                </TableRowMenu>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </div>

      {/* Keyed by item so every open starts from fresh state. */}
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

