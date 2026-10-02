"use client"

import { type FormEvent, useEffect, useState, useTransition } from "react"
import type { ImprovementListItem } from "@agent-hub/core"
import { canAutoFocus } from "@/lib/auto-focus"
import { Search } from "lucide-react"
import {
  createImprovementFromMessageAction,
  linkMessageToImprovementAction,
  listImprovementsPageAction,
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
import { SlidingPanel, useSlidingDirection } from "@/components/motion/sliding-panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs"
import { RollInText } from "@/components/motion/roll-in-text"
import { RollingNumber } from "@/components/motion/rolling-number"

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
  const slideDirection = useSlidingDirection(tab, ["create", "link"])
  const [title, setTitle] = useState("")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [existing, setExisting] = useState<ImprovementListItem[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
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
      setNextCursor(null)
      setLoadingMore(false)
      setLoadFailed(false)
      setError(null)
    }
  }

  // Lazily load existing improvements when the Link tab is first shown.
  useEffect(() => {
    if (tab === "link" && existing === null && messageId) {
      listImprovementsPageAction({ limit: 100 })
        .then((page) => {
          setExisting(page.items)
          setNextCursor(page.nextCursor)
        })
        .catch(() => {
          setExisting([])
          setNextCursor(null)
          setLoadFailed(true)
          setError("Could not load improvements. Close the dialog and try again.")
        })
    }
  }, [tab, existing, messageId])

  function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    listImprovementsPageAction({ cursor: nextCursor, limit: 100 })
      .then((page) => {
        setExisting((current) => {
          const seen = new Set((current ?? []).map((item) => item.id))
          return [
            ...(current ?? []),
            ...page.items.filter((item) => !seen.has(item.id)),
          ]
        })
        setNextCursor(page.nextCursor)
      })
      .catch(() => setError("Could not load more improvements"))
      .finally(() => setLoadingMore(false))
  }

  const open = messageId !== null

  function handleOpenChange(next: boolean) {
    if (!next) onClose()
  }

  function createNew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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

  const needle = search.trim().toLowerCase()
  const filtered = (existing ?? []).filter((i) => {
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
          <DialogTitle className="text-lg font-semibold">Improve Answer</DialogTitle>
          <DialogDescription>
            Add this message to the improvements list by creating a new item or
            linking it to a similar existing improvement.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList aria-label="Improvement source">
            {(
              [
                ["create", "Create New Improvement"],
                ["link", "Link Existing Improvement"],
              ] as const
            ).map(([key, label]) => (
              <TabsTrigger key={key} value={key}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <SlidingPanel activeKey={tab} direction={slideDirection} sizing="flow">
        {tab === "create" ? (
          <form id="improve-answer-create" onSubmit={createNew}>
            <Input
              aria-label="Improvement title"
              name="improvement-title"
              autoComplete="off"
              autoFocus={canAutoFocus()}
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Improvement title"
              className="h-11 rounded-lg"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              <RollingNumber value={title.length} />/{TITLE_MAX}
            </p>
          </form>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search existing improvements"
                aria-describedby="improve-answer-search-hint"
                type="search"
                name="improvement-search"
                autoComplete="off"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search improvements…"
                className="h-10 rounded-lg pl-9"
              />
            </div>
            <p id="improve-answer-search-hint" className="text-xs text-muted-foreground">
              Searches the improvements loaded below.
            </p>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {existing === null && (
                <p role="status" className="py-6 text-center text-sm text-muted-foreground">
                  Loading improvements…
                </p>
              )}
              {existing !== null && existing.length === 0 && !loadFailed && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No improvements to link yet.
                </p>
              )}
              {existing !== null && existing.length > 0 && filtered.length === 0 && (
                <p className="py-6 text-center text-sm [overflow-wrap:anywhere] text-muted-foreground">
                  No matches for “{search.trim()}”
                </p>
              )}
              {filtered.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  aria-pressed={selectedId === i.id}
                  onClick={() => setSelectedId(i.id)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
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
              {nextCursor && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  <RollInText text={loadingMore ? "Loading…" : "Load more improvements"} />
                </Button>
              )}
            </div>
          </div>
        )}

        </SlidingPanel>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="-mx-4 -mb-4 flex justify-end gap-2 rounded-b-xl border-t bg-muted/50 p-4">
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          {tab === "create" ? (
            // Outside the form, so it submits it by id: Enter in the title
            // field and this button take the same path.
            <Button type="submit" form="improve-answer-create" disabled={pending || !title.trim()}>
              <RollInText text={pending ? "Creating…" : "Create Improvement"} />
            </Button>
          ) : (
            <Button onClick={linkExisting} disabled={pending || !selectedId}>
              <RollInText text={pending ? "Linking…" : "Link Improvement"} />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
