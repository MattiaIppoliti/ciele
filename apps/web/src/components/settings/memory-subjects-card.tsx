"use client";

import { useState, useTransition } from "react";
import type { Memory, MemorySubjectSummary } from "@agent-hub/core";
import { Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
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

/**
 * Admin erasure surface over long-term memories (#666): look up a signed-in
 * user by subject or identity claim, review what the assistants remember
 * about them, delete a single memory, or wipe everything — enough to honor
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
    setOpenSubject(subjectId);
    setMemories([]);
    startTransition(async () => {
      try {
        setMemories(await listSubjectMemoriesAction(subjectId));
      } catch {
        toast.error("Could not load memories");
      }
    });
  }

  function deleteOne(subjectId: string, memoryId: string) {
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
    if (!window.confirm("Delete every memory held for this user? This cannot be undone.")) {
      return;
    }
    startTransition(async () => {
      try {
        await wipeSubjectMemoriesAction(subjectId);
        setWiped((prev) => new Set(prev).add(subjectId));
        setOpenSubject(null);
        setMemories([]);
        toast.success("All memories deleted");
      } catch {
        toast.error("Could not delete the memories");
      }
    });
  }

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-[18px]" />
          Remembered users
        </CardTitle>
        <CardDescription>
          Every signed-in user your assistants hold memories about. Look a
          user up to review, delete, or fully erase what is remembered —
          erasure is complete and immediate.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {subjects.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No memories stored yet.
          </p>
        ) : (
          <>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by user id or identity claim"
              className="mb-4 max-w-sm"
            />
            {visible.length === 0 && (
              <p className="text-muted-foreground text-sm">No matching users.</p>
            )}
            <div className="grid gap-2">
              {visible.map((s) => (
                <div key={s.subjectId} className="rounded-lg border">
                  <button
                    type="button"
                    onClick={() =>
                      openSubject === s.subjectId
                        ? setOpenSubject(null)
                        : open(s.subjectId)
                    }
                    className="hover:bg-muted/50 flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
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
                      {s.memoryCount}{" "}
                      {s.memoryCount === 1 ? "memory" : "memories"}
                    </span>
                  </button>
                  {openSubject === s.subjectId && (
                    <div className="border-t px-4 py-3">
                      {isPending && memories.length === 0 ? (
                        <p className="text-muted-foreground text-sm">Loading…</p>
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
                              <span className="min-w-0">{m.text}</span>
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => deleteOne(s.subjectId, m.id)}
                                  disabled={isPending}
                                  aria-label="Delete memory"
                                  className="text-muted-foreground hover:text-destructive shrink-0"
                                >
                                  <Trash2 className="size-4" />
                                </button>
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
