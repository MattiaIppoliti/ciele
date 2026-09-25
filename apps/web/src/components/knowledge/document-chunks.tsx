"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import type { DocumentChunkListItem } from "@agent-hub/core";
import {
  Button,
  CopyFeedbackIcon,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  useCopyFeedback,
} from "@agent-hub/ui";
import { listDocumentChunksAction } from "@/app/actions";
import {
  chunkLabel,
  chunkPreview,
  chunkWordCount,
  filterChunks,
  pageForChunkIndex,
} from "@/lib/document-chunks";
import { toast } from "@/lib/toast";

/**
 * A Document's chunks (#929): the slices retrieval actually matches, which is
 * how a Member answers "why did the widget cite this page".
 *
 * The route renders the first page; this holds what is loaded, filters it on
 * the client, and fetches another page only when the dialog's arrows walk off
 * the end of one. Nothing here writes, and no embedding ever reaches it: the
 * operation returns id, index and text.
 */
export function DocumentChunks({
  sourceId,
  documentId,
  assistantId,
  initialChunks,
  total,
  pageSize,
  openChunkId,
}: {
  sourceId: string;
  documentId: string;
  assistantId?: string;
  initialChunks: DocumentChunkListItem[];
  total: number;
  pageSize: number;
  /** A chunk the Memories tab's Evidence asked to open (#932). */
  openChunkId?: string;
}) {
  // Keyed by index, because the pager thinks in indexes and a page is just
  // where a given index happened to arrive from.
  const [loaded, setLoaded] = useState<Map<number, DocumentChunkListItem>>(
    () => new Map(initialChunks.map((chunk) => [chunk.index, chunk]))
  );
  const [query, setQuery] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  /** Closing the dialog also dismisses whatever `?chunk=` asked to open. */
  const [dismissedNamed, setDismissedNamed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const chunks = useMemo(
    () => [...loaded.values()].sort((a, b) => a.index - b.index),
    [loaded]
  );

  // "Open chunk" from a memory's Evidence names a chunk id, and a memory does
  // not record which page it landed on. The index is **derived** from what is
  // loaded rather than pushed into state by an effect: an effect that calls
  // setState synchronously cascades renders, and the answer is a function of
  // the URL and the loaded set anyway.
  const namedIndex =
    !dismissedNamed && openChunkId
      ? ([...loaded.values()].find((chunk) => chunk.id === openChunkId)?.index ??
        null)
      : null;
  const activeIndex = openIndex ?? namedIndex;

  // The only thing the effect does is fetch: walk forward until the named
  // chunk turns up or the pages run out. Most Documents have one page, so
  // this usually costs nothing, and it beats inventing a "which page is this
  // id on" read for one link.
  useEffect(() => {
    if (!openChunkId || dismissedNamed || namedIndex !== null) return;
    if (loaded.size >= total) return;
    fetchPageFor(loaded.size);
    // `loaded` drives the retry: each fetched page re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChunkId, dismissedNamed, namedIndex, loaded, total]);
  const shown = useMemo(() => filterChunks(chunks, query), [chunks, query]);
  const open = activeIndex === null ? null : (loaded.get(activeIndex) ?? null);

  function fetchPageFor(index: number) {
    startTransition(async () => {
      try {
        const page = await listDocumentChunksAction({
          sourceId,
          documentId,
          assistantId,
          page: pageForChunkIndex(index, pageSize),
        });
        setLoaded((current) => {
          const next = new Map(current);
          for (const chunk of page.items) next.set(chunk.index, chunk);
          return next;
        });
      } catch {
        toast.error("Could not load more chunks");
        setOpenIndex(null);
        setDismissedNamed(true);
      }
    });
  }

  function step(delta: number) {
    if (activeIndex === null) return;
    const target = activeIndex + delta;
    if (target < 0 || target >= total) return;
    setOpenIndex(target);
    // The neighbour is on the next page: keep the dialog open and fill it in.
    if (!loaded.has(target)) fetchPageFor(target);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {total} {total === 1 ? "chunk" : "chunks"}
          {chunks.length < total && ` · ${chunks.length} loaded`}
        </p>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-4" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chunks…"
            aria-label="Search the loaded chunks"
            className="w-64 pl-8"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground bg-card rounded-xl border px-5 py-10 text-center text-sm">
          {chunks.length === 0
            ? "Nothing indexes this Document yet."
            : "No loaded chunk contains that."}
        </p>
      ) : (
        <div className="grid gap-3 @lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">
          {shown.map((chunk) => (
            // The card is a group, not one button: the preview opens the
            // dialog on click as before, and the corner control at the top
            // right of the index is the same action made visible, for a
            // reader who does not know a card is clickable.
            <div
              key={chunk.id}
              className="bg-card hover:bg-accent/50 relative rounded-xl border transition-colors"
            >
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1.5 right-1.5 size-7"
                aria-label={`Open chunk ${chunkLabel(chunk.index)}`}
                title="Open"
                onClick={() => setOpenIndex(chunk.index)}
              >
                <Maximize2 className="size-3.5" />
              </Button>
              <button
                type="button"
                onClick={() => setOpenIndex(chunk.index)}
                className="press block w-full p-3 pr-10 text-left"
              >
                <span className="text-muted-foreground block font-mono text-xs">
                  {chunkLabel(chunk.index)}
                </span>
                <span className="mt-1 block text-sm leading-relaxed">
                  {chunkPreview(chunk.text)}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {chunks.length < total && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => fetchPageFor(chunks.length)}
        >
          Load more
        </Button>
      )}

      <ChunkDialog
        chunk={open}
        index={activeIndex}
        total={total}
        loading={isPending}
        onClose={() => {
          setOpenIndex(null);
          setDismissedNamed(true);
        }}
        onStep={step}
      />
    </div>
  );
}

function ChunkDialog({
  chunk,
  index,
  total,
  loading,
  onClose,
  onStep,
}: {
  chunk: DocumentChunkListItem | null;
  index: number | null;
  total: number;
  loading: boolean;
  onClose: () => void;
  onStep: (delta: number) => void;
}) {
  const { copyText, isCopied } = useCopyFeedback<string>();
  const text = chunk?.text ?? "";
  const copied = isCopied(text);

  return (
    <Dialog open={index !== null} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono">
            Chunk {index === null ? "" : chunkLabel(index)}
          </DialogTitle>
        </DialogHeader>

        <pre className="max-h-[55vh] overflow-y-auto rounded-md border p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {loading && !chunk ? "Loading…" : text}
        </pre>

        <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous chunk"
              disabled={index === null || index === 0}
              onClick={() => onStep(-1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="font-mono">
              {index === null ? "" : chunkLabel(index)} / {chunkLabel(total - 1)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next chunk"
              disabled={index === null || index >= total - 1}
              onClick={() => onStep(1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </span>
          <span className="flex items-center gap-2">
            <span className="font-mono uppercase">
              {chunkWordCount(text)} words
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={copied ? "Chunk copied" : "Copy chunk"}
              onClick={async () => {
                if (await copyText(text, text)) toast.success("Chunk copied");
                else toast.error("Could not copy the chunk");
              }}
            >
              <CopyFeedbackIcon copied={copied} className="size-4" />
            </Button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
