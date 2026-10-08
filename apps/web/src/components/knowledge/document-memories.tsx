"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge as StatusPill } from "@/components/spaceui/status-badge";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, RotateCcw } from "lucide-react";
import { EyeOff, Maximize2 } from "lucide-react";
import type { KnowledgeMemory, MemoriesEmptyState } from "@agent-hub/core";
import { DialogBody,
  Badge,
  Button,
  CopyFeedbackIcon,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Hint,
  Input,
  useCopyFeedback,
} from "@agent-hub/ui";
import {
  Table,
  TableActions,
  TableBody,
  TableCard,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TableColumnHeader,
  useClientSort,
  useClientPage,
} from "@/components/ui/table-column-header";
import {
  useColumnWidths,
  type TableColumnLayout,
} from "@/components/ui/table-columns";
import {
  SelectAllHead,
  SelectRowCell,
  TableBulkBar,
  useRowSelection,
} from "@/components/ui/table-selection";
import { TableSearch } from "@/components/ui/table-filters";
import { TablePagination } from "@/components/ui/table-pagination";
import { Switch } from "@/components/ui/motion-switch";
import { TableRowMenu } from "@/components/ui/table-menu";
import {
  forgetMemoryAction,
  listDocumentMemoriesAction,
  restoreMemoryAction,
} from "@/app/actions";
import {
  forgettableIds,
  liveMemoryCount,
  memoryActorLabel,
  memoryStateLabel,
  visibleMemories,
} from "@/lib/document-memories";
import { ExtractMemoriesButton } from "@/components/knowledge/extract-memories-button";
import { relativeTimeLabel } from "@/lib/source-documents";
import { toast } from "@/lib/toast";
import { copyToClipboard } from "@/lib/clipboard";
import { formatDateTime, formatDay } from "@/lib/format";
import { RollingNumber } from "@/components/motion/rolling-number";

/**
 * A Document's Memories (#932): the facts extracted from the page, one
 * sentence per row.
 *
 * Forgetting is the only thing this tab writes, and it is a state: the row
 * stays, keeps its evidence, leaves retrieval, and hides under the filter
 * until somebody asks for it. Nothing here calls a model.
 */
export function DocumentMemories({
  sourceId,
  documentPath,
  collectionName,
  initialMemories,
  emptyState,
  canEdit,
  chunksHref,
}: {
  sourceId: string;
  documentPath: string;
  collectionName: string;
  initialMemories: KnowledgeMemory[];
  /** Why the list is empty, when it is (#933). */
  emptyState: MemoriesEmptyState;
  canEdit: boolean;
  /** Where "Open chunk" goes: the Chunks tab, with the chunk named. */
  chunksHref: string;
}) {
  const [memories, setMemories] = useState(initialMemories);
  const [query, setQuery] = useState("");
  const [showForgotten, setShowForgotten] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const order = useClientSort();
  const visible = useMemo(
    () => visibleMemories(memories, showForgotten),
    [memories, showForgotten]
  );
  const rows = order.sorted(visible.filter((memory) => memory.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), {
    memory: (memory) => memory.text,
    state: (memory) => memoryStateLabel(memory),
    updated: (memory) => memory.updatedAt,
  });
  const paged = useClientPage(rows);
  const selection = useRowSelection(paged.items.map((memory) => memory.id));
  const columns = useColumnWidths("document-memories", [
    ...(canEdit
      ? [{ key: "select", width: 44, fixed: true } as TableColumnLayout]
      : []),
    { key: "memory", width: 460, min: 200 },
    { key: "state", width: 130 },
    { key: "updated", width: 160 },
    { key: "actions", width: 140, fixed: true },
  ] satisfies TableColumnLayout[]);
  const open = memories.find((memory) => memory.id === openId) ?? null;
  const live = liveMemoryCount(memories);

  async function refresh() {
    const fresh = await listDocumentMemoriesAction({
      sourceId,
      documentPath,
      includeForgotten: true,
    });
    setMemories(fresh);
    selection.clear();
  }

  function forget(ids: string[], reason?: string) {
    if (ids.length === 0) return;
    startTransition(async () => {
      try {
        for (const id of ids) await forgetMemoryAction(id, reason);
        await refresh();
        toast.success(
          ids.length === 1
            ? "Forgotten. It stays here and leaves retrieval."
            : `${ids.length} memories forgotten.`
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not forget that");
      }
    });
  }

  function restore(id: string) {
    startTransition(async () => {
      try {
        await restoreMemoryAction(id);
        await refresh();
        toast.success("Restored.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not restore that");
      }
    });
  }

  function copyMemoryText(text: string) {
    void copyToClipboard(
      text,
      "Copied.",
      "Could not copy. Check the browser allows clipboard access."
    );
  }

  const selectedForgettable = forgettableIds(
    memories,
    new Set(selection.ids)
  );

  return (
    <div className="space-y-4">
      <TableCard title="Memories" results={{ total: rows.length, noun: "memory", pluralNoun: "memories" }}
        filters={<>
          <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-sm">
            Show forgotten
            <Switch checked={showForgotten} onCheckedChange={(next: boolean) => { setShowForgotten(next); paged.onPageChange(1); }}
              aria-label="Show forgotten memories" />
          </label>
          <span className="text-muted-foreground text-xs"><RollingNumber value={live} /> live</span>
          <TableSearch label="Search memories" value={query} onChange={(value) => { setQuery(value); paged.onPageChange(1); }} />
        </>}
        footer={<TablePagination page={paged.page} pageSize={paged.pageSize} total={rows.length} noun="memory"
          pluralNoun="memories" onPageChange={paged.onPageChange} onPageSizeChange={paged.onPageSizeChange} />}>
          {canEdit && (
            <TableBulkBar
              selection={selection}
              count={selection.count}
              noun="memory"
              pluralNoun="memories"
              onClear={selection.clear}
            >
              <Button
                variant="outline"
                size="sm"
                // Everything ticked can already be forgotten, or the button
                // would promise a write on rows that are forgotten already.
                disabled={isPending || selectedForgettable.length === 0}
                onClick={() => forget(selectedForgettable)}
              >
                Forget <RollingNumber value={selectedForgettable.length} />
              </Button>
            </TableBulkBar>
          )}
          <Table fixed empty={rows.length === 0}>
            {columns.colGroup}
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {canEdit && (
                  <SelectAllHead
                    selection={selection}
                    state={selection.allState}
                    onToggle={selection.toggleAll}
                  />
                )}
                <TableColumnHeader
                  label="Memory"
                  resize={columns.handleFor("memory")}
                  sort={order.column("memory", {
                    asc: "A to Z",
                    desc: "Z to A",
                  })}
                />
                <TableColumnHeader
                  label="State"
                  resize={columns.handleFor("state")}
                  sort={order.column("state")}
                />
                <TableColumnHeader
                  label="Updated"
                  resize={columns.handleFor("updated")}
                  sort={order.column("updated", {
                    asc: "Oldest first",
                    desc: "Newest first",
                  })}
                />
                <TableColumnHeader label="Actions" className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={canEdit ? 5 : 4}>
                {query ? <EmptyState size="sm" title="No matching memories"  /> :
                  <MemoriesEmpty state={emptyState} sourceId={sourceId} canEdit={canEdit} />}
              </TableCell></TableRow>}
              {paged.items.map((memory) => (
                <TableRowMenu
                  key={memory.id}
                  title={memory.text.slice(0, 60)}
                  actions={[
                    {
                      label: "Open memory",
                      icon: Maximize2,
                      onSelect: () => setOpenId(memory.id),
                    },
                    {
                      label: "Copy text",
                      icon: Copy,
                      onSelect: () => copyMemoryText(memory.text),
                    },
                    canEdit &&
                      (memory.forgottenAt
                        ? {
                            label: "Restore",
                            icon: RotateCcw,
                            disabled: isPending,
                            onSelect: () => restore(memory.id),
                          }
                        : {
                            label: "Forget",
                            icon: EyeOff,
                            destructive: true,
                            disabled: isPending,
                            onSelect: () => forget([memory.id]),
                          }),
                  ]}
                >
                <TableRow
                  data-state={
                    selection.isSelected(memory.id) ? "selected" : undefined
                  }
                >
                  {canEdit && (
                    <SelectRowCell
                      checked={selection.isSelected(memory.id)}
                      onToggle={() => selection.toggle(memory.id)}
                      label={`"${memory.text}"`}
                    />
                  )}
                  <TableCell className="whitespace-normal">
                    {/* The sentence wraps rather than truncating: it is the
                        row's whole content, and half a fact is worse than a
                        second line. */}
                    <button
                      type="button"
                      onClick={() => setOpenId(memory.id)}
                      className="press-text block w-full text-left hover:underline"
                    >
                      <span className="line-clamp-3 [overflow-wrap:anywhere]">
                        {memory.text}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {memoryStateLabel(memory)}
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={new Date(memory.updatedAt).toISOString()}
                    suppressHydrationWarning
                  >
                    {relativeTimeLabel(memory.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <TableActions>
                      <Hint label="Open memory">
                        <Button variant="ghost" size="icon-sm" aria-label={`Open memory: ${memory.text}`}
                          onClick={() => setOpenId(memory.id)}>
                          <Maximize2 className="size-4" />
                        </Button>
                      </Hint>
                      <Hint label="Copy text">
                        <Button variant="ghost" size="icon-sm" aria-label={`Copy memory text: ${memory.text}`}
                          onClick={() => copyMemoryText(memory.text)}>
                          <Copy className="size-4" />
                        </Button>
                      </Hint>
                      {canEdit && <Hint label={memory.forgottenAt ? "Restore memory" : "Forget memory"}>
                        <Button variant="ghost" size="icon-sm" disabled={isPending}
                          data-destructive={!memory.forgottenAt || undefined}
                          aria-label={`${memory.forgottenAt ? "Restore" : "Forget"} memory: ${memory.text}`}
                          onClick={() => memory.forgottenAt ? restore(memory.id) : forget([memory.id])}>
                          {memory.forgottenAt ? <RotateCcw className="size-4" /> : <EyeOff className="size-4" />}
                        </Button>
                      </Hint>}
                    </TableActions>
                  </TableCell>
                </TableRow>
                </TableRowMenu>
              ))}
            </TableBody>
          </Table>
        </TableCard>

      <MemoryDialog
        memory={open}
        collectionName={collectionName}
        canEdit={canEdit}
        busy={isPending}
        chunksHref={chunksHref}
        onClose={() => setOpenId(null)}
        onForget={(reason) => {
          if (open) forget([open.id], reason);
          setOpenId(null);
        }}
        onRestore={() => {
          if (open) restore(open.id);
          setOpenId(null);
        }}
      />
    </div>
  );
}

/**
 * Why the list is empty, said out loud (#933).
 *
 * "No memories yet." is true and useless: it reads as a broken feature when
 * the honest answer is that nothing has run yet, or that nobody connected a
 * model. Each case names the one thing that would change it.
 */
function MemoriesEmpty({
  state,
  sourceId,
  canEdit,
}: {
  state: MemoriesEmptyState;
  sourceId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const extracting = state.kind === "extracting";
  // A poll, not a stream, like the ingestion activity card: the jobs are
  // drained by whichever worker or cron tick gets there, so there is nothing
  // to hold open. Each refresh re-reads the ledger, the count moves, and the
  // list replaces this state the moment the page's own job lands.
  useEffect(() => {
    if (!extracting) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [extracting, router]);

  return (
    <div className="bg-card space-y-3 rounded-xl border px-5 py-10 text-center">
      {state.kind === "no_provider" && (
        <EmptyState size="sm" title="Memories need a Provider Connection"
          description="Connect a model and the next crawl of this source extracts its memories."
          action={<Link href="/settings/ai" className="press-text text-primary underline underline-offset-4">Settings → AI</Link>}
        />
      )}
      {state.kind === "not_extracted" && (
        <EmptyState size="sm" title="No memories yet"
          description={state.nextCrawlAt ? `Next crawl: ${formatDay(state.nextCrawlAt)}.` : canEdit ? "Use Extract memories to start." : "An Editor can extract memories from the Source page."}
          action={canEdit ? <ExtractMemoriesButton sourceId={sourceId} /> : undefined}
        />
      )}
      {state.kind === "extracting" && (
        <>
          <p className="font-medium">Extracting…</p>
          <p className="text-muted-foreground text-sm" aria-live="polite">{state.remaining === 1 ? "1 document queued." : `${state.remaining} documents queued.`}</p>
        </>
      )}
      {state.kind === "failed" && (
        <>
          <p className="font-medium">Extraction failed</p>
          <p className="text-muted-foreground text-sm">
            {state.lastError ?? "The attempts ran out."}{" "}
            <Link href="/alerts" className="text-primary hover:underline">
              See the alert
            </Link>
            .
          </p>
          {canEdit && (
            <div className="flex justify-center pt-1">
              <ExtractMemoriesButton sourceId={sourceId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MemoryDialog({
  memory,
  collectionName,
  canEdit,
  busy,
  chunksHref,
  onClose,
  onForget,
  onRestore,
}: {
  memory: KnowledgeMemory | null;
  collectionName: string;
  canEdit: boolean;
  busy: boolean;
  chunksHref: string;
  onClose: () => void;
  onForget: (reason?: string) => void;
  onRestore: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const { copyText, isCopied } = useCopyFeedback<string>();
  const copied = isCopied(memory?.id ?? "");

  return (
    <Dialog
      open={memory !== null}
      onOpenChange={(open: boolean) => {
        if (!open) {
          setConfirming(false);
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg leading-relaxed font-medium [overflow-wrap:anywhere]">
            {memory?.text}
          </DialogTitle>
        </DialogHeader>

        <DialogBody>
          {memory && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {memoryActorLabel(memory.generatedBy)}
                </Badge>
                {memory.forgottenAt && (
                  <StatusPill status="offline" primaryText="Forgotten" />
                )}
              </div>

              <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2 font-mono text-xs">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatDateTime(memory.createdAt)}</dd>
                <dt className="text-muted-foreground">Updated</dt>
                <dd>{formatDateTime(memory.updatedAt)}</dd>
                <dt className="text-muted-foreground">ID</dt>
                <dd className="flex items-center gap-1 break-all">
                  {memory.id}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={copied ? "Memory ID copied" : "Copy memory ID"}
                    onClick={async () => {
                      if (await copyText(memory.id, memory.id)) {
                        toast.success("Memory ID copied");
                      } else {
                        toast.error("Could not copy the memory ID");
                      }
                    }}
                  >
                    <CopyFeedbackIcon copied={copied} className="size-3.5" />
                  </Button>
                </dd>
                <dt className="text-muted-foreground">Sources</dt>
                <dd>
                  {memory.sourceCount}
                  <span className="text-muted-foreground ml-2 font-sans">
                    {memory.sourceCount === 1
                      ? "the page said it once"
                      : "the page has said it this many times"}
                  </span>
                </dd>
                <dt className="text-muted-foreground">Collection</dt>
                <dd className="font-sans">
                  <Badge variant="secondary">{collectionName}</Badge>
                </dd>
                {memory.forgetReason && (
                  <>
                    <dt className="text-muted-foreground">Reason</dt>
                    <dd className="font-sans [overflow-wrap:anywhere]">
                      {memory.forgetReason}
                    </dd>
                  </>
                )}
              </dl>

              <section className="space-y-2">
                <h3 className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
                  Evidence
                </h3>
                <blockquote className="border-l-2 pl-4 text-sm italic [overflow-wrap:anywhere]">
                  {memory.quote || "No quote was recorded for this memory."}
                </blockquote>
                {memory.chunkId ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    render={
                      <Link href={`${chunksHref}&chunk=${memory.chunkId}`} />
                    }
                    className="hover:bg-accent press inline-flex items-center rounded-md border px-3 py-1.5 text-sm"
                  >
                    Open chunk
                  </Button>
                ) : null}
                {memory.conceptId === null && (
                  <p className="text-muted-foreground text-xs">
                    {/* The memory outlived the Document row it was read from,
                      which is what keying on the page rather than the row
                      buys (ADR-0024). */}
                    This memory predates the current version of the page.
                  </p>
                )}
              </section>

              {canEdit && (
                <div className="border-t pt-4">
                  {memory.forgottenAt ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={onRestore}
                    >
                      Restore
                    </Button>
                  ) : confirming ? (
                    <div className="space-y-2">
                      <Input
                        value={reason}
                        onChange={(e) =>
                          setReason(e.target.value.slice(0, 500))
                        }
                        placeholder="Why? (optional)"
                        aria-label="Reason for forgetting"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          disabled={busy}
                          onClick={() => onForget(reason.trim() || undefined)}
                        >
                          Forget memory
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setConfirming(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        It stays here with its evidence, leaves retrieval, and
                        can be restored.
                      </p>
                    </div>
                  ) : (
                    <Button
                      variant="destructive"
                      onClick={() => setConfirming(true)}
                    >
                      Forget memory
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
