"use client";

import { EmptyState } from "@/components/ui/empty-state";

import { useId, useRef, useState, useTransition } from "react";
import type { Memory, MemorySubjectSummary } from "@agent-hub/core";
import { Trash2, UserRound } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@agent-hub/ui";
import {
  deleteSubjectMemoryAction,
  listSubjectMemoriesAction,
  wipeSubjectMemoriesAction,
} from "@/app/actions";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";
import { RollingNumber } from "@/components/motion/rolling-number";

/**
 * Admin erasure surface over long-term memories (#666): look up a signed-in
 * user by subject or identity claim, review what the assistants remember
 * about them, delete a single memory, or wipe everything, enough to honor
 * a data-erasure request on the spot. The org is the data controller.
 */
export function MemorySubjectsCard({
  subjects,
  canEdit,
}: {
  subjects: MemorySubjectSummary[];
  canEdit: boolean;
}) {
  const [search, setSearch] = useState("");
  const [openSubject, setOpenSubject] = useState<string | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [wiped, setWiped] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [isLoading, startLoad] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const panelId = useId();
  // The subject whose memories were asked for last. Opening a second subject
  // before the first answers must not fill its panel with the first's list.
  const requested = useRef<string | null>(null);

  const visible = subjects.filter((s) => {
    if (wiped.has(s.subjectId)) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      s.subjectId.toLowerCase().includes(needle) ||
      (s.claimValue ?? "").toLowerCase().includes(needle)
    );
  });

  function open(subjectId: string) {
    requested.current = subjectId;
    setOpenSubject(subjectId);
    setMemories([]);
    startLoad(async () => {
      try {
        const list = await listSubjectMemoriesAction(subjectId);
        if (requested.current === subjectId) setMemories(list);
      } catch {
        if (requested.current === subjectId) {
          toast.error("Could not load memories");
        }
      }
    });
  }

  function close() {
    requested.current = null;
    setOpenSubject(null);
  }

  function deleteOne(subjectId: string, memoryId: string) {
    confirmDelete({
      title: "Delete this memory?",
      description: "The assistant stops using it for this user. This cannot be undone.",
      confirmLabel: "Delete memory",
      onConfirm: () => deleteOneNow(subjectId, memoryId),
    });
  }

  function deleteOneNow(subjectId: string, memoryId: string) {
    startTransition(async () => {
      try {
        await deleteSubjectMemoryAction(subjectId, memoryId);
        setMemories((prev) => prev.filter((m) => m.id !== memoryId));
        toast.success("Memory deleted");
      } catch {
        toast.error("Could not delete the memory");
      }
    });
  }

  function wipeAll(subjectId: string) {
    confirmDelete({
      title: "Delete every memory for this user?",
      description: "Everything the assistant remembers about this user goes. This cannot be undone.",
      confirmLabel: "Delete all",
      onConfirm: () => wipeAllNow(subjectId),
    });
  }

  function wipeAllNow(subjectId: string) {
    startTransition(async () => {
      try {
        await wipeSubjectMemoriesAction(subjectId);
        setWiped((prev) => new Set(prev).add(subjectId));
        close();
        setMemories([]);
        toast.success("All memories deleted");
      } catch {
        toast.error("Could not delete the memories");
      }
    });
  }

  return (
    <Card className="mt-8">
      {confirmDeleteModal}
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-[18px]" />
          Remembered users
        </CardTitle>
        <CardDescription>
          Signed-in users your assistants remember. Review or erase a user&apos;s memories here; erasure is immediate.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {subjects.length === 0 ? (
          <EmptyState size="sm" title="No remembered users yet" description="Users appear here when your assistants store their memories." />
        ) : (
          <>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by user id or identity claim"
              aria-label="Search remembered users"
              type="search"
              autoComplete="off"
              spellCheck={false}
              className="mb-4 max-w-sm"
            />
            {visible.length === 0 && (
              <p className="text-muted-foreground text-sm">No matching users.</p>
            )}
            <div className="grid gap-2">
              {visible.map((s, index) => (
                <div key={s.subjectId} className="rounded-lg border">
                  <button
                    type="button"
                    aria-expanded={openSubject === s.subjectId}
                    aria-controls={`${panelId}-${index}`}
                    onClick={() =>
                      openSubject === s.subjectId ? close() : open(s.subjectId)
                    }
                    className="press-control hover:bg-muted/50 flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {s.claimValue ?? s.subjectId}
                      </span>
                      {s.claimValue && (
                        <span className="text-muted-foreground block truncate text-xs">
                          {s.subjectId}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      <RollingNumber value={s.memoryCount} />{" "}
                      {s.memoryCount === 1 ? "memory" : "memories"}
                    </span>
                  </button>
                  {openSubject === s.subjectId && (
                    <div id={`${panelId}-${index}`} className="border-t px-4 py-3">
                      {isLoading && memories.length === 0 ? (
                        <p role="status" className="text-muted-foreground text-sm">
                          Loading…
                        </p>
                      ) : memories.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                          Nothing remembered.
                        </p>
                      ) : (
                        <ul className="grid gap-2">
                          {memories.map((m) => (
                            <li
                              key={m.id}
                              className="flex items-start justify-between gap-3 text-sm"
                            >
                              <span className="min-w-0 [overflow-wrap:anywhere]">{m.text}</span>
                              {canEdit && (
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="icon-sm"
                                  onClick={() => deleteOne(s.subjectId, m.id)}
                                  disabled={isPending}
                                  aria-label="Delete memory"
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {canEdit && (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="mt-3"
                          disabled={isPending}
                          onClick={() => wipeAll(s.subjectId)}
                        >
                          Delete all memories for this user
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
