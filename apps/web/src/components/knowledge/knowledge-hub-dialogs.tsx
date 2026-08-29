"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
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
import { toast } from "@/lib/toast";

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
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Linked assistants</Label>
        <span className="text-muted-foreground text-xs">
          {selected.length} selected
        </span>
      </div>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search assistant..."
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
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(
    item?.linkedAssistants.map((l) => l.assistantId) ?? []
  );
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link assistants</DialogTitle>
          <DialogDescription>
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending || !item}
            onClick={() =>
              startTransition(async () => {
                try {
                  await setSourceLinksAction(item!.id, selected);
                  toast.success("Linked assistants updated.");
                  router.refresh();
                  onClose();
                } catch {
                  toast.error("Could not update the links.");
                }
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const router = useRouter();
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
        router.refresh();
      } catch {
        toast.error("Could not update direct access.");
      }
    });

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage direct access</DialogTitle>
          <DialogDescription>
            When direct access is on, chat users can open “{item?.name}”
            directly from the AI chat. When off, it&apos;s still cited inline
            but the link stays hidden. Set this per assistant.
          </DialogDescription>
        </DialogHeader>
        {disabled && (
          <p className="text-muted-foreground rounded-md border p-3 text-sm">
            This file was uploaded before originals were stored, so direct
            access is unavailable. Re-upload the file to enable it.
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
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
      >
        {title}
        <ChevronDown
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="space-y-3 border-t p-3">{children}</div>}
    </div>
  );
}

/** Hub "Add website", entire site or page list, with the advanced knobs. */
export function AddWebsiteDialog({
  open,
  assistants,
  onClose,
}: {
  open: boolean;
  assistants: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [includeGlobs, setIncludeGlobs] = useState("");
  const [excludeGlobs, setExcludeGlobs] = useState("");
  const [throttle, setThrottle] = useState(false);
  const [pageTimeoutSecs, setPageTimeoutSecs] = useState("30");
  const [waitSecs, setWaitSecs] = useState("2");
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

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
        toast.success("Website added, crawling in the background.");
        router.refresh();
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not add the website."
        );
      }
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Main website"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hub-site-url">Knowledge base URL</Label>
            <Input
              id="hub-site-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <CollapsibleSection title="Custom URL filtering rules">
            <div className="space-y-1.5">
              <Label>Positive search filters (one per line)</Label>
              <Textarea
                value={includeGlobs}
                onChange={(e) => setIncludeGlobs(e.target.value.slice(0, 2000))}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Negative search filters (one per line)</Label>
              <Textarea
                value={excludeGlobs}
                onChange={(e) => setExcludeGlobs(e.target.value.slice(0, 2000))}
                rows={3}
              />
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
                <Label>Page timeout (seconds)</Label>
                <Input
                  value={pageTimeoutSecs}
                  onChange={(e) => setPageTimeoutSecs(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Wait before extraction (seconds)</Label>
                <Input
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending || !url.trim() || selected.length === 0}
            onClick={submit}
          >
            Add website
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hub "Add file", upload + link in one step. */
export function AddFileDialog({
  open,
  assistants,
  onClose,
}: {
  open: boolean;
  assistants: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.set("file", file);
      formData.set("assistantIds", JSON.stringify(selected));
      const result = await uploadOrgFileSourceAction(formData);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("File uploaded, indexing in the background.");
      router.refresh();
      onClose();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add file</DialogTitle>
          <DialogDescription>
            Linked assistants will use this file to answer questions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input ref={fileRef} type="file" />
          <AssistantMultiSelect
            assistants={assistants}
            selected={selected}
            onChange={setSelected}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending || selected.length === 0}
            onClick={submit}
          >
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const router = useRouter();
  const [question, setQuestion] = useState(editing?.name ?? "");
  // The table row only carries an answer excerpt; load the full answer once.
  // The parent keys this dialog by the edited row, so state starts fresh.
  const [answer, setAnswer] = useState(editing?.answerPreview ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    getOrgFaqAction(editing.id)
      .then((faq) => {
        if (cancelled) return;
        setQuestion(faq.question);
        setAnswer(faq.answer);
      })
      .catch(() => toast.error("Could not load the FAQ."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () =>
    startTransition(async () => {
      try {
        if (editing) {
          await updateOrgFaqAction(editing.id, question, answer);
        } else {
          await createOrgFaqAction(question, answer, selected);
        }
        toast.success(editing ? "FAQ updated." : "FAQ created.");
        router.refresh();
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not save the FAQ."
        );
      }
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit FAQ" : "New FAQ"}</DialogTitle>
          <DialogDescription>
            Add sets of questions and answers to fine tune AI responses.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Question</Label>
            <Input
              value={question}
              onChange={(e) =>
                setQuestion(e.target.value.slice(0, FAQ_QUESTION_MAX))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Answer</Label>
            <Textarea
              value={answer}
              onChange={(e) =>
                setAnswer(e.target.value.slice(0, FAQ_ANSWER_MAX))
              }
              rows={6}
            />
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              isPending ||
              !question.trim() ||
              !answer.trim() ||
              (!editing && selected.length === 0)
            }
            onClick={submit}
          >
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hub CSV import, two columns, question then answer. */
export function ImportFaqsDialog({
  open,
  assistants,
  onClose,
}: {
  open: boolean;
  assistants: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const file = fileRef.current?.files?.[0];
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
        router.refresh();
        onClose();
      } catch {
        toast.error("Import failed.");
      }
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import FAQs</DialogTitle>
          <DialogDescription>
            A CSV with two columns: question, then answer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input ref={fileRef} type="file" accept=".csv,text/csv" />
          <AssistantMultiSelect
            assistants={assistants}
            selected={selected}
            onChange={setSelected}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending || selected.length === 0}
            onClick={submit}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
