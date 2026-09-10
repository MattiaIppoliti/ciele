import { HTTP_FLOW_METHODS, type HttpFlowMethod } from "@agent-hub/core";
import type { FlowDraft } from "@/lib/flow-editor";

/**
 * A Flow draft kept in the browser between visits (#837).
 *
 * The builder's draft already survives switching between the Form and the
 * Canvas, because both renderings edit one object. It did not survive a reload,
 * a navigation, or a closed tab, which is the case that actually loses work: an
 * Editor who half-builds a Flow, goes to check a Help Desk id, and comes back
 * to an empty form.
 *
 * So the draft is written here on every change and restored on the next visit.
 * Deliberately **browser-only**, not a server-side draft row:
 *
 * - A Flow the server holds is a Flow the runtime can be asked to run. A draft
 *   is by definition not ready for that, and giving it a row invites the
 *   question of which one Publish takes.
 * - It is one Member's unfinished thought, not the Organization's. Two Editors
 *   on one Flow should not inherit each other's half-edits, and the key is
 *   scoped by Member for that reason.
 *
 * The stored draft is a *resumption*, never an authority: it is only restored
 * when it actually differs from the saved Flow, and saving or deleting the Flow
 * clears it. Anything that does not parse is dropped rather than trusted,
 * storage is writable by anything in the origin.
 */

/**
 * Bumped when `FlowDraft` changes shape, so an old draft is dropped, not
 * coerced. 2: `httpMethods` joined the draft (#843); a version-1 draft has no
 * field to validate, and restoring one would let Save send
 * `httpRequest: { methods: undefined }`.
 */
export const DRAFT_VERSION = 2;

interface StoredDraft {
  version: number;
  savedAt: string;
  draft: FlowDraft;
}

/** What a restored draft tells the builder. */
export interface RestoredDraft {
  draft: FlowDraft;
  savedAt: string;
}

/**
 * Where one Member's draft of one Flow lives. A new Flow has no id, so it keys
 * on `new`: there is one unsaved new Flow per Assistant at a time, and coming
 * back to "New flow" should find the one you were writing.
 */
export function flowDraftKey(
  memberId: string,
  assistantId: string,
  flowId: string | null
): string {
  return `flow-draft:${memberId}:${assistantId}:${flowId ?? "new"}`;
}

/**
 * Whether a draft differs from the Flow it was opened from. The comparison is
 * structural (`JSON.stringify` over the same field order, since both come from
 * `draftFromFlow` or a patch of it), which is what makes "restore only when
 * there is something to restore" cheap enough to run on every keystroke.
 */
export function draftDiffers(draft: FlowDraft, saved: FlowDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(saved);
}

/** The payload written to storage, or null when there is nothing worth keeping. */
export function serializeDraft(draft: FlowDraft, saved: FlowDraft, now: Date): string | null {
  if (!draftDiffers(draft, saved)) return null;
  const stored: StoredDraft = {
    version: DRAFT_VERSION,
    savedAt: now.toISOString(),
    draft,
  };
  return JSON.stringify(stored);
}

/**
 * A stored draft, or null. Returns null for anything this build cannot use: a
 * different version, a malformed payload, or a draft that matches the saved
 * Flow anyway (restoring that would announce a draft that changes nothing).
 */
export function parseStoredDraft(raw: string | null, saved: FlowDraft): RestoredDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { version, savedAt, draft } = parsed as Partial<StoredDraft>;
  if (version !== DRAFT_VERSION) return null;
  if (typeof savedAt !== "string") return null;
  if (!isFlowDraft(draft)) return null;
  if (!draftDiffers(draft, saved)) return null;
  return { draft, savedAt };
}

/**
 * The shape check. Not a full validation of every action's settings: the draft
 * goes through the same status rules the form applies before it can be saved,
 * so a draft with nonsense in one field is a draft that will not save, which is
 * exactly what an in-progress draft is allowed to be.
 */
function isFlowDraft(value: unknown): value is FlowDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Partial<FlowDraft>;
  return (
    typeof draft.name === "string" &&
    (draft.trigger === null || typeof draft.trigger === "string") &&
    typeof draft.dwell === "object" &&
    draft.dwell !== null &&
    typeof draft.dwell.minutes === "number" &&
    typeof draft.dwell.seconds === "number" &&
    Array.isArray(draft.httpMethods) &&
    draft.httpMethods.every((method) => HTTP_FLOW_METHODS.includes(method as HttpFlowMethod)) &&
    (draft.conditionLogic === "all" || draft.conditionLogic === "any") &&
    Array.isArray(draft.conditions) &&
    Array.isArray(draft.actions) &&
    draft.actions.every((action) => typeof action === "string") &&
    typeof draft.settings === "object" &&
    draft.settings !== null &&
    typeof draft.customMessage === "string"
  );
}

/** "Draft saved 3 minutes ago", for the header's quiet reassurance. */
export function draftSavedLabel(savedAt: string, now: Date): string {
  const then = new Date(savedAt).getTime();
  if (!Number.isFinite(then)) return "Draft saved";
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 45) return "Draft saved just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Draft saved ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Draft saved ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `Draft saved ${days} day${days === 1 ? "" : "s"} ago`;
}
