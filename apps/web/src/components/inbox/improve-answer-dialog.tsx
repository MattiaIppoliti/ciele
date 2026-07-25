"use client"

import { useEffect, useState, useTransition } from "react"
import type { ImprovementListItem } from "@agent-hub/db"
import { Search } from "lucide-react"
import {
  createImprovementFromMessageAction,
  linkMessageToImprovementAction,
  listImprovementsAction,
} from "@/app/actions"
import { Button } from "@agent-hub/ui"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@agent-hub/ui"
import { Input } from "@agent-hub/ui"

const TITLE_MAX = 100

type Tab = "create" | "link"

/**
 * "Improve Answer" modal. Adds a flagged assistant message to the improvements
 * list either by creating a new item or linking it to an existing one.
 */
export function ImproveAnswerDialog({
  messageId,
  onClose,
  onChanged,
}: {
  /** The flagged message; the dialog is open when this is non-null. */
  messageId: string | null
  onClose: () => void
  /** Called after a successful create/link so the caller can refresh chips. */
  onChanged: () => void
}) {
  const [tab, setTab] = useState<Tab>("create")
  const [title, setTitle] = useState("")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [existing, setExisting] = useState<ImprovementListItem[] | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Reset the form whenever the dialog opens for a different message. This is
  // the "adjust state during render when a prop changes" pattern (preferred
  // over a setState-in-effect); it re-renders once before painting.
  const [lastMessageId, setLastMessageId] = useState(messageId)
  if (messageId !== lastMessageId) {
    setLastMessageId(messageId)
    if (messageId) {
      setTab("create")
      setTitle("")
      setSearch("")
      setSelectedId(null)
      setExisting(null)
      setError(null)
    }
  }

  // Lazily load existing improvements when the Link tab is first shown.
  useEffect(() => {
    if (tab === "link" && existing === null && messageId) {
      listImprovementsAction()
        .then(setExisting)
        .catch(() => setExisting([]))
    }
  }, [tab, existing, messageId])

  const open = messageId !== null

  function handleOpenChange(next: boolean) {
    if (!next) onClose()
  }

  function createNew() {
    if (!messageId || !title.trim()) return
    setError(null)
    startTransition(async () => {
      try {
        await createImprovementFromMessageAction(messageId, title)
        onChanged()
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create improvement")
      }
    })
  }

  function linkExisting() {
    if (!messageId || !selectedId) return
    setError(null)
    startTransition(async () => {
      try {
        await linkMessageToImprovementAction(messageId, selectedId)
        onChanged()
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not link improvement")
      }
    })
  }

  const filtered = (existing ?? []).filter((i) => {
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return (
      i.title.toLowerCase().includes(needle) ||
      `imp-${i.seq}`.includes(needle)
    )
  })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Improve Answer</DialogTitle>
          <DialogDescription>
            Add this message to the improvements list by creating a new item or
            linking it to a similar existing improvement.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-6 border-b">
          {(
            [
              ["create", "Create New Improvement"],
              ["link", "Link Existing Improvement"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 pb-2 text-sm font-medium transition-colors ${
                tab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "create" ? (
          <div>
            <Input
              autoFocus
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Improvement title"
              className="h-11 rounded-lg"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {title.length}/{TITLE_MAX}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search improvements..."
                className="h-10 rounded-lg pl-9"
              />
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {existing === null && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Loading improvements…
                </p>
              )}
              {existing !== null && filtered.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No improvements to link yet.
                </p>
              )}
              {filtered.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => setSelectedId(i.id)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedId === i.id
                      ? "border-primary bg-primary/5 dark:bg-primary/20"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <span className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-xs">
                    IMP-{i.seq}
                  </span>
                  <span className="truncate">{i.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4">
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          {tab === "create" ? (
            <Button onClick={createNew} disabled={pending || !title.trim()}>
              {pending ? "Creating…" : "Create Improvement"}
            </Button>
          ) : (
            <Button onClick={linkExisting} disabled={pending || !selectedId}>
              {pending ? "Linking…" : "Link Improvement"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
