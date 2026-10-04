"use client";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Archive02Icon, Delete02Icon, Flag01Icon } from "@hugeicons/core-free-icons";
import type { ThreadTarget } from "@agent-hub/core";
import SwipeRow, { type SwipeAction } from "@/components/SwipeRow";
import { useThreadPreferences } from "@/components/thread-preferences";
import { ConfirmDeleteModal } from "@/components/ui/confirm-delete-modal";
import { deleteThreadAction } from "@/app/thread-actions";
import { chatSession } from "@/lib/chat-session";
import { toast } from "@/lib/toast";
import { useTouchNavigation } from "@/components/shell/mobile-navigation";

export function ThreadSwipeRow({ target, label, height = 64, radius = 8, disabled = false, canDelete = true, onDeleted, children }: {
  target: ThreadTarget; label: string; height?: number; radius?: number;
  disabled?: boolean; canDelete?: boolean; onDeleted?: () => void; children: ReactNode;
}) {
  const preferences = useThreadPreferences();
  const touch = useTouchNavigation();
  const [pending, setPending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const router = useRouter(); const pathname = usePathname(); const search = useSearchParams();
  const session = useSyncExternalStore(chatSession.subscribe, chatSession.getSnapshot, chatSession.getSnapshot);
  const busy = disabled || pending || preferences.busy(target) || !preferences.ready || (session.busy && (target.kind === "channel" ? pathname === `/teammates/channels/${target.id}` : session.conversationId === target.id));
  const archived = preferences.archived(target); const flagged = preferences.flagged(target);
  const actions: SwipeAction[] = [
    { id: "archive", label: archived ? "Restore" : "Archive", icon: <HugeiconsIcon icon={Archive02Icon} size={20} />, dismiss: true },
    { id: "flag", label: flagged ? "Unflag" : "Flag", icon: <HugeiconsIcon icon={Flag01Icon} size={20} />, dismiss: false },
    ...(canDelete ? [{ id: "delete", label: "Delete", icon: <HugeiconsIcon icon={Delete02Icon} size={20} />, color: "#e5484d", dismiss: false }] : []),
  ];
  async function archive() {
    setPending(true);
    try { await preferences.set(target, "archive", !archived); toast.success(archived ? "Restored" : "Archived for you"); }
    catch (error) { toast.error("Could not update archive. Try again."); throw error; }
    finally { setPending(false); }
  }
  async function flag() {
    setPending(true);
    try { await preferences.set(target, "flag", !flagged); toast.success(flagged ? "Flag removed" : "Flagged for you"); }
    catch { toast.error("Could not update flag. Try again."); }
    finally { setPending(false); }
  }
  async function remove() {
    setPending(true);
    try {
      await deleteThreadAction(target); preferences.removed(target);
      if (target.kind === "conversation") chatSession.forget(target.id); setDeleteOpen(false);
      if (onDeleted) onDeleted();
      else if (target.kind === "channel" && pathname === `/teammates/channels/${target.id}`) router.push("/teammates");
      else if (target.kind === "conversation" && search.get("c") === target.id) chatSession.requestNewChat();
      router.refresh(); toast.success("Deleted");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not delete. Try again."); }
    finally { setPending(false); }
  }
  return <>
    <SwipeRow actions={actions} disabled={busy} label={label} onAction={action => {
      if (action.id === "delete") setDeleteOpen(true);
      else if (action.id === "flag") void flag();
    }} onCommit={archive} actionColor="var(--muted)" drawerColor="var(--muted)" rowColor="var(--background)" textColor="var(--foreground)" height={touch ? Math.max(44, height) : height} radius={radius} actionWidth={44} direction="left" collapseMs={200} commitAt={0.6} fullSwipe haptic={false}
      className="[&_[data-swipe-surface]]:gap-0 [&_[data-swipe-surface]]:px-0 [&_[data-swipe-surface]>a]:pr-8 [&_[data-swipe-surface]>button:first-child]:pr-8 [&_[data-swipe-surface]>a]:h-full [&_[data-swipe-surface]>a]:w-full">
      {children}
      {flagged && <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-muted-foreground" role="img" aria-label="Flagged"><HugeiconsIcon icon={Flag01Icon} size={14} /></span>}
    </SwipeRow>
    <ConfirmDeleteModal open={deleteOpen} pending={pending} title={`Delete ${label}?`} description={target.kind === "channel" ? "This deletes the group and its transcript for everyone. This cannot be undone." : "This permanently deletes the conversation and its transcript. This cannot be undone."} onClose={() => setDeleteOpen(false)} onConfirm={() => void remove()} />
  </>;
}
