"use client";

import { ASSISTANT_BUNDLE_MAX_BYTES } from "@agent-hub/core";
import { exportAssistantBundleAction, importAssistantBundleAction } from "@/app/(admin)/assistants/bundle-actions";
import { downloadFile } from "@/lib/download";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@agent-hub/ui";
import { ManageAccessDialog } from "./manage-access-dialog";
import { listAssistantAccessAction } from "@/app/(admin)/assistants/access-actions";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { CopyPlus, Trash2 } from "lucide-react";
import { Ellipsis } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { toast } from "@/lib/toast";
import { duplicateAssistantAction } from "@/app/actions";
import { DeleteAssistantModal } from "@/components/assistants/delete-assistant-modal";
import { Button } from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyFeedbackIcon, Hint, useCopyFeedback } from "@agent-hub/ui";
import { RollInText, RollRow } from "@/components/motion/roll-in-text";

/** Editor top-bar "More options" menu: Copy ID / Duplicate / Delete assistant. */
export function AssistantOptionsMenu({
  assistantId,
  assistantTitle,
  canEdit,
  canDelete,
  canManageAccess,
}: {
  assistantId: string;
  assistantTitle: string;
  canEdit: boolean;
  canDelete: boolean;
  canManageAccess: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [access, setAccess] = useState<Awaited<ReturnType<typeof listAssistantAccessAction>> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bundleInput = useRef<HTMLInputElement>(null);
  const [bundleResult, setBundleResult] = useState<{ assistantId: string; report: string[] } | null>(null);
  function exportBundle() { startTransition(async () => { try { const bundle = await exportAssistantBundleAction(assistantId); downloadFile(JSON.stringify(bundle, null, 2), "application/json", "assistant-bundle.json"); } catch { toast.error("Could not export the Assistant"); } }); }
  async function importBundle(file: File | undefined) {
    if (!file) return;
    if (file.size > ASSISTANT_BUNDLE_MAX_BYTES) { toast.error("The bundle must be 5 MB or smaller"); return; }
    startTransition(async () => {
      try { const bundle: unknown = JSON.parse(await file.text()); const response = await importAssistantBundleAction(bundle); if (response.ok) setBundleResult(response.result); else toast.error(response.error); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Could not import the Assistant bundle"); }
    });
  }
  const { copyText, isCopied } = useCopyFeedback<"id">();
  const copied = isCopied("id");

  // Copy ID is here for every role: the header hides its standalone copy
  // button on a phone, so this menu is the only way to it there.
  async function copyId() {
    if (await copyText("id", assistantId)) toast.success("Assistant ID copied");
    else toast.error("Could not copy the assistant ID");
  }

  function handleDuplicate() {
    startTransition(async () => {
      try {
        const copy = await duplicateAssistantAction(assistantId);
        toast.success(`Duplicated as “${copy.title}”`);
        router.push(`/assistants/${copy.id}`);
      } catch {
        toast.error("Could not duplicate the assistant. Try again.");
      }
    });
  }

  return (
    <>
    <DropdownMenu>
      <Hint label="More options">
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="More options"
              disabled={isPending}
            />
          }
        >
          <Ellipsis className="size-4" />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end">
        <DropdownMenuItem closeOnClick={false} onClick={() => void copyId()}>
          <CopyFeedbackIcon copied={copied} className="size-4" />
          <RollInText text={copied ? "Copied" : "Copy ID"} />
        </DropdownMenuItem>
        {canManageAccess && <DropdownMenuItem onClick={() => startTransition(async () => {
          try { setAccess(await listAssistantAccessAction(assistantId)); } catch { toast.error("Could not load Assistant access"); }
        })}>Manage access</DropdownMenuItem>}
        <DropdownMenuItem onClick={exportBundle}>Export bundle</DropdownMenuItem>
        {canEdit && <DropdownMenuItem onClick={() => bundleInput.current?.click()}>Import bundle as new Assistant</DropdownMenuItem>}
        {canEdit && (
          <DropdownMenuItem onClick={handleDuplicate}>
            <AnimatedIcon icon={CopyPlus} size={16} /> Duplicate assistant
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <AnimatedIcon icon={Trash2} size={16} /> Delete assistant
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    <input ref={bundleInput} type="file" accept="application/json,.json" className="hidden" aria-label="Assistant bundle" onChange={event => { void importBundle(event.target.files?.[0]); event.target.value = ""; }} />
    <Dialog open={Boolean(bundleResult)} onOpenChange={open => { if (!open) setBundleResult(null); }}><DialogContent><DialogHeader><DialogTitle>Assistant imported</DialogTitle></DialogHeader><DialogBody><p className="text-sm">The import creates a new Assistant.</p>{bundleResult?.report.length ? <div role="list" className="mt-3 space-y-2 text-sm">{bundleResult.report.map((item, index) => <RollRow key={item} index={index}><p role="listitem"><RollInText text={item} /></p></RollRow>)}</div> : <p className="text-muted-foreground mt-3 text-sm">All references are resolved.</p>}</DialogBody><DialogFooter><Button onClick={() => { if (bundleResult) router.push(`/assistants/${bundleResult.assistantId}`); setBundleResult(null); }}>Open Assistant</Button></DialogFooter></DialogContent></Dialog>
    {access && <ManageAccessDialog key={assistantId} assistantId={assistantId} open onClose={() => setAccess(null)} initialMembers={access} />}
    <DeleteAssistantModal
      assistantId={assistantId}
      assistantTitle={assistantTitle}
      open={confirmDelete}
      onClose={() => setConfirmDelete(false)}
      onDeleted={() => router.push("/")}
    />
    </>
  );
}
