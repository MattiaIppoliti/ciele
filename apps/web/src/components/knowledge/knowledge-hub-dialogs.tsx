"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import type { OrgKnowledgeSourceListItem } from "@agent-hub/core";
import { ChevronDown } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@agent-hub/ui";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/motion-switch";
import { Textarea } from "@/components/ui/textarea";
import {
  addOrgWebsiteSourceAction,
  createOrgFaqAction,
  getOrgFaqAction,
  importOrgFaqsAction,
  setSourceDirectAccessAction,
  setSourceLinksAction,
  updateOrgFaqAction,
  uploadOrgFileSourceAction,
} from "@/app/actions";
import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX } from "@/lib/faq-csv";
import { ingestionStarted } from "@/lib/ingestion-bus";
import { formatCount } from "@/lib/format";
import { toast } from "@/lib/toast";
import { useDiscardGuard } from "./use-discard-guard";

/** Shared by the two crawl filter boxes, which the input cuts at this length. */
const FILTER_MAX = 2000;

/**
 * "412 / 2,000" under an input that stops at a maximum, so the cut is visible
 * instead of keystrokes silently going nowhere.
 */
function LimitCounter({ value, max }: { value: string; max: number }) {
  return (
    <p className="text-muted-foreground text-right text-xs">
      <RollingNumber value={value.length} /> / {formatCount(max)}
    </p>
  );
}

/** Searchable multi-select over the Organization's Assistants. */
export function AssistantMultiSelect({
  assistants,
  selected,
  onChange,
}: {
  assistants: Array<{ id: string; title: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const labelId = useId();
  const filtered = useMemo(
    () =>
      assistants.filter((a) =>
        a.title.toLowerCase().includes(query.toLowerCase())
      ),
    [assistants, query]
  );
  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id]
    );
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <div className="flex items-center justify-between">
        <span id={labelId} className="text-sm leading-none font-medium">
          Linked assistants
        </span>
        <span className="text-muted-foreground text-xs">
          <RollingNumber value={selected.length} /> selected
        </span>
      </div>
      <Input
        aria-label="Search assistants"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search assistant…"
      />
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
        {filtered.length === 0 && (
          <p className="text-muted-foreground p-2 text-sm">No assistants.</p>
        )}
        {filtered.map((a) => (
          <label
            key={a.id}
            className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
          >
            <Checkbox
              checked={selected.includes(a.id)}
              onCheckedChange={() => toggle(a.id)}
            />
            <span className="truncate">{a.title}</span>
            <span className="text-muted-foreground ml-auto font-mono text-xs">
              {a.id.slice(0, 8)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** "Manage linked assistants", choose which assistants can use this item. */
export function LinkAssistantsDialog({
  item,
  assistants,
  onClose,
}: {
  item: OrgKnowledgeSourceListItem | null;
  assistants: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const [initial] = useState(
    () => item?.linkedAssistants.map((l) => l.assistantId) ?? []
  );
  const [selected, setSelected] = useState<string[]>(initial);
  const [isPending, startTransition] = useTransition();
  const dirty =
    selected.length !== initial.length ||
    selected.some((id) => !initial.includes(id));
  const { requestClose, confirmDeleteModal } = useDiscardGuard({
    open: item !== null,
    dirty,
    pending: isPending,
    onClose,
    description: "The link changes are not saved yet.",
  });

  return (
    <>
    <Dialog open={item !== null} onOpenChange={(open) => !open && requestClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link assistants</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            Choose which assistants can use “{item?.name}”. Unlinking takes
            effect immediately.
          </DialogDescription>
        </DialogHeader>
        <AssistantMultiSelect
          assistants={assistants}
          selected={selected}
          onChange={setSelected}
        />
        <DialogFooter>
          <Button variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending || !item}
            onClick={() =>
              startTransition(async () => {
                try {
                  await setSourceLinksAction(item!.id, selected);
                  toast.success("Linked assistants updated.");
                  onClose();
                } catch {
                  toast.error("Could not update the links.");
                }
              })
            }
          >
            <RollInText text={isPending ? "Saving…" : "Save"} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmDeleteModal}
    </>
  );
}

/**
 * "Manage direct access" (PRD #726): per-assistant toggles over a file's
 * linked Assistants. On = chat users of that assistant can open the file
 * directly from the AI chat; off = it is still cited inline, but the link
 * stays hidden.
 */
export function ManageDirectAccessDialog({
  item,
  onClose,
}: {
  item: OrgKnowledgeSourceListItem | null;
  onClose: () => void;
}) {
  const [links, setLinks] = useState(item?.linkedAssistants ?? []);
  const [isPending, startTransition] = useTransition();
  const disabled = !item?.originalObjectPath;

  const toggle = (assistantId: string, next: boolean) =>
    startTransition(async () => {
      try {
        await setSourceDirectAccessAction(item!.id, assistantId, next);
        setLinks((prev) =>
          prev.map((l) =>
            l.assistantId === assistantId ? { ...l, directAccess: next } : l
          )
        );
      } catch {
        toast.error("Could not update direct access.");
      }
    });

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage direct access</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">
            When direct access is on, chat users can open “{item?.name}”
            directly from the AI chat. When off, it&apos;s still cited inline
            but the link stays hidden. Set this per assistant.
          </DialogDescription>
        </DialogHeader>
        {disabled && (
          <p className="text-muted-foreground rounded-md border p-3 text-sm">
            The original isn&apos;t stored for this file. Re-upload it to open it.
          </p>
        )}
        <div className="space-y-1 rounded-md border p-2">
          {links.length === 0 && (
            <p className="text-muted-foreground p-2 text-sm">
              Link this file to an assistant first.
            </p>
          )}
          {links.map((link) => (
            <div
              key={link.assistantId}
              className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm"
            >
              <span className="truncate">
                {link.assistantName || link.assistantId}
              </span>
              <Switch
                checked={link.directAccess}
                disabled={disabled || isPending}
                aria-label={`Allow ${link.assistantName || link.assistantId} direct access`}
                onCheckedChange={(next) => toggle(link.assistantId, next)}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <div className="rounded-md border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
      >
        {title}
        <ChevronDown
          aria-hidden="true"
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {/* Always mounted, so `aria-controls` names an element that exists. */}
      <div id={contentId} hidden={!open} className="space-y-3 border-t p-3">
        {children}
      </div>
    </div>
  );
}

/**
 * Hub "Add website", entire site or page list, with the advanced knobs. The
 * parent remounts it per open, so a reopen after a success starts empty.
 */
export function AddWebsiteDialog({
  open,
  assistants,
  onClose,
}: {
  open: boolean;
  assistants: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [includeGlobs, setIncludeGlobs] = useState("");
  const [excludeGlobs, setExcludeGlobs] = useState("");
  const [throttle, setThrottle] = useState(false);
  const [pageTimeoutSecs, setPageTimeoutSecs] = useState("30");
  const [waitSecs, setWaitSecs] = useState("2");
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const dirty =
    name.trim() !== "" ||
    url.trim() !== "" ||
    includeGlobs !== "" ||
    excludeGlobs !== "" ||
    throttle ||
    pageTimeoutSecs !== "30" ||
    waitSecs !== "2" ||
    selected.length > 0;
  const { requestClose, confirmDeleteModal } = useDiscardGuard({
    open,
    dirty,
    pending: isPending,
    onClose,
    description: "This website has not been added yet.",
  });

  const submit = () =>
    startTransition(async () => {
      try {
        await addOrgWebsiteSourceAction(
          {
            name,
            url,
            includeGlobs: includeGlobs || undefined,
            excludeGlobs: excludeGlobs || undefined,
            throttle,
            pageTimeoutSecs: Number.parseInt(pageTimeoutSecs, 10) || undefined,
            waitSecs: Number.parseInt(waitSecs, 10) || undefined,
          },
          selected
        );
        ingestionStarted();
        toast.success("Website added, crawling in the background.");
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not add the website."
        );
      }
    });

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add website</DialogTitle>
          <DialogDescription>
            We automatically check the websites you add for updates once a
            week.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="hub-site-name">Name</Label>
            <Input
              id="hub-site-name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Main website"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-site-url">Knowledge base URL</Label>
            <Input
              id="hub-site-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <CollapsibleSection title="Custom URL filtering rules">
            <div className="space-y-1.5">
              <Label htmlFor="hub-site-include">
                Positive search filters (one per line)
              </Label>
              <Textarea
                id="hub-site-include"
                spellCheck={false}
                value={includeGlobs}
                onChange={(e) =>
                  setIncludeGlobs(e.target.value.slice(0, FILTER_MAX))
                }
                rows={3}
              />
              <LimitCounter value={includeGlobs} max={FILTER_MAX} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hub-site-exclude">
                Negative search filters (one per line)
              </Label>
              <Textarea
                id="hub-site-exclude"
                spellCheck={false}
                value={excludeGlobs}
                onChange={(e) =>
                  setExcludeGlobs(e.target.value.slice(0, FILTER_MAX))
                }
                rows={3}
              />
              <LimitCounter value={excludeGlobs} max={FILTER_MAX} />
            </div>
          </CollapsibleSection>
          <CollapsibleSection title="Additional settings">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={throttle}
                onCheckedChange={(v) => setThrottle(v === true)}
              />
              Throttle requests (for rate-limited sites)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hub-site-timeout">Page timeout (seconds)</Label>
                <Input
                  id="hub-site-timeout"
                  autoComplete="off"
                  value={pageTimeoutSecs}
                  onChange={(e) => setPageTimeoutSecs(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hub-site-wait">
                  Wait before extraction (seconds)
                </Label>
                <Input
                  id="hub-site-wait"
                  autoComplete="off"
                  value={waitSecs}
                  onChange={(e) => setWaitSecs(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
          </CollapsibleSection>
          <AssistantMultiSelect
            assistants={assistants}
            selected={selected}
            onChange={setSelected}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending || !url.trim() || selected.length === 0}
            onClick={submit}
          >
            <RollInText text={isPending ? "Adding…" : "Add website"} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmDeleteModal}
    </>
  );
}

/** Hub "Add file", upload + link in one step. Remounted per open, like the above. */
export function AddFileDialog({
  open,
  assistants,
  onClose,
}: {
  open: boolean;
  assistants: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const { requestClose, confirmDeleteModal } = useDiscardGuard({
    open,
    dirty: file !== null || selected.length > 0,
    pending: isPending,
    onClose,
    description: "This file has not been uploaded yet.",
  });

  const submit = () =>
    startTransition(async () => {
      if (!file) return;
      const formData = new FormData();
      formData.set("file", file);
      formData.set("assistantIds", JSON.stringify(selected));
      try {
        const result = await uploadOrgFileSourceAction(formData);
        if (result?.error) {
          toast.error(result.error);
          return;
        }
        ingestionStarted();
        toast.success("File uploaded, indexing in the background.");
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not upload the file."
        );
      }
    });

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add file</DialogTitle>
          <DialogDescription>
            Linked assistants will use this file to answer questions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="file"
            aria-label="File to upload"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <AssistantMultiSelect
            assistants={assistants}
            selected={selected}
            onChange={setSelected}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending || !file || selected.length === 0}
            onClick={submit}
          >
            <RollInText text={isPending ? "Uploading…" : "Upload"} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmDeleteModal}
    </>
  );
}

/** Hub FAQ create/edit. Editing keeps the existing links; creating picks them. */
export function FaqDialog({
  open,
  editing,
  assistants,
  onClose,
}: {
  open: boolean;
  /** The FAQ Source row being edited, or null for a new FAQ. */
  editing: OrgKnowledgeSourceListItem | null;
  assistants: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const editingId = editing?.id ?? null;
  const [question, setQuestion] = useState(editing?.name ?? "");
  // The table row only carries an answer excerpt. Saving that excerpt would
  // overwrite the real answer with its first few lines, so an edit stays
  // locked until the full FAQ has loaded, and for good if it never does.
  // The parent keys this dialog by the edited row, so state starts fresh.
  const [answer, setAnswer] = useState(editing?.answerPreview ?? "");
  const [load, setLoad] = useState<"loading" | "ready" | "failed">(
    editing ? "loading" : "ready"
  );
  /** What the load returned, so closing an untouched edit asks nothing. */
  const [loaded, setLoaded] = useState<{ question: string; answer: string } | null>(
    null
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    getOrgFaqAction(editingId)
      .then((faq) => {
        if (cancelled) return;
        setQuestion(faq.question);
        setAnswer(faq.answer);
        setLoaded(faq);
        setLoad("ready");
      })
      .catch(() => {
        if (!cancelled) setLoad("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  const ready = load === "ready";
  const dirty = editing
    ? loaded !== null &&
      (question !== loaded.question || answer !== loaded.answer)
    : question.trim() !== "" || answer.trim() !== "" || selected.length > 0;
  const { requestClose, confirmDeleteModal } = useDiscardGuard({
    open,
    dirty,
    pending: isPending,
    onClose,
    description: editing
      ? "The edits to this FAQ are not saved yet."
      : "This FAQ has not been created yet.",
  });

  const submit = () =>
    startTransition(async () => {
      try {
        if (editing) {
          await updateOrgFaqAction(editing.id, question, answer);
        } else {
          await createOrgFaqAction(question, answer, selected);
        }
        toast.success(editing ? "FAQ updated." : "FAQ created.");
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not save the FAQ."
        );
      }
    });

  const submitLabel = editing
    ? isPending
      ? "Saving…"
      : "Save"
    : isPending
      ? "Creating…"
      : "Create";

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit FAQ" : "New FAQ"}</DialogTitle>
          <DialogDescription>
            Add sets of questions and answers to fine tune AI responses.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {load === "failed" && (
            <p
              role="alert"
              className="border-destructive/40 text-destructive rounded-md border p-3 text-sm"
            >
              Could not load the full answer, so this FAQ cannot be saved from
              here. Close the dialog and try again.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="hub-faq-question">Question</Label>
            <Input
              id="hub-faq-question"
              autoComplete="off"
              disabled={!ready}
              value={question}
              onChange={(e) =>
                setQuestion(e.target.value.slice(0, FAQ_QUESTION_MAX))
              }
            />
            <LimitCounter value={question} max={FAQ_QUESTION_MAX} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-faq-answer">Answer</Label>
            <Textarea
              id="hub-faq-answer"
              disabled={!ready}
              aria-busy={load === "loading"}
              value={answer}
              onChange={(e) =>
                setAnswer(e.target.value.slice(0, FAQ_ANSWER_MAX))
              }
              rows={6}
            />
            {load === "loading" ? (
              <p role="status" className="text-muted-foreground text-xs">
                Loading the full answer…
              </p>
            ) : (
              <LimitCounter value={answer} max={FAQ_ANSWER_MAX} />
            )}
          </div>
          {!editing && (
            <AssistantMultiSelect
              assistants={assistants}
              selected={selected}
              onChange={setSelected}
            />
          )}
          {editing && (
            <p className="text-muted-foreground text-xs">
              Links are managed from the row’s{" "}
              <Badge variant="outline">Manage linked assistants</Badge>{" "}
              control.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            disabled={
              isPending ||
              !ready ||
              !question.trim() ||
              !answer.trim() ||
              (!editing && selected.length === 0)
            }
            onClick={submit}
          >
            <RollInText text={submitLabel} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmDeleteModal}
    </>
  );
}

/** Hub CSV import, two columns, question then answer. Remounted per open. */
export function ImportFaqsDialog({
  open,
  assistants,
  onClose,
}: {
  open: boolean;
  assistants: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const { requestClose, confirmDeleteModal } = useDiscardGuard({
    open,
    dirty: file !== null || selected.length > 0,
    pending: isPending,
    onClose,
    description: "These FAQs have not been imported yet.",
  });

  const submit = () =>
    startTransition(async () => {
      if (!file) return;
      const formData = new FormData();
      formData.set("file", file);
      formData.set("assistantIds", JSON.stringify(selected));
      try {
        const { imported, skipped } = await importOrgFaqsAction(formData);
        toast.success(
          `Imported ${imported} FAQ${imported === 1 ? "" : "s"}${
            skipped.length > 0 ? ` (${skipped.length} skipped)` : ""
          }.`
        );
        onClose();
      } catch {
        toast.error("Import failed. Check the CSV has two columns and try again.");
      }
    });

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import FAQs</DialogTitle>
          <DialogDescription>
            A CSV with two columns: question, then answer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            type="file"
            accept=".csv,text/csv"
            aria-label="FAQ CSV file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <AssistantMultiSelect
            assistants={assistants}
            selected={selected}
            onChange={setSelected}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending || !file || selected.length === 0}
            onClick={submit}
          >
            <RollInText text={isPending ? "Importing…" : "Import"} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {confirmDeleteModal}
    </>
  );
}
