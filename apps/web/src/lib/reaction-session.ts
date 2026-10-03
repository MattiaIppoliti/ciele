import type { MessageReaction } from "@agent-hub/core";

interface ReactionReceipt { reactions: MessageReaction[]; actorId: string }
interface ReactionState extends ReactionReceipt { available: boolean; saving: boolean; error: string | null }

function parseReceipt(value: unknown): ReactionReceipt | null {
  if (!value || typeof value !== "object" || !("reactions" in value) || !Array.isArray(value.reactions) || !("actorId" in value) || typeof value.actorId !== "string") return null;
  const reactions: MessageReaction[] = [];
  for (const row of value.reactions) {
    if (!row || typeof row !== "object" || typeof row.organizationId !== "string" || typeof row.messageId !== "string" || (row.channelMessageId !== null && typeof row.channelMessageId !== "string") || typeof row.actorId !== "string" || typeof row.actorName !== "string" || typeof row.emoji !== "string") return null;
    reactions.push({ organizationId: row.organizationId, messageId: row.messageId, channelMessageId: row.channelMessageId, actorId: row.actorId, actorName: row.actorName, emoji: row.emoji });
  }
  return { reactions, actorId: value.actorId };
}

/** One reply's social reactions. A read can never roll back a later mutation. */
export function createReactionSession(endpoint: string, request: (url: string, init?: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)) {
  let state: ReactionState = { reactions: [], actorId: "", available: false, saving: false, error: null };
  let revision = 0;
  let active = true;
  const controllers = new Set<AbortController>();
  const listeners = new Set<() => void>();
  function publish(patch: Partial<ReactionState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async load() {
      // A refresh cannot invalidate the mutation that will return fresh state.
      if (state.saving) return;
      active = true;
      const started = ++revision;
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const response = await request(endpoint, { signal: controller.signal });
        const receipt = response.ok ? parseReceipt(await response.json()) : null;
        if (receipt && active && started === revision) publish({ ...receipt, available: true });
      } catch {
        // Offline, denied or before the additive schema: no reaction controls.
      } finally { controllers.delete(controller); }
    },
    async toggle(emoji: string): Promise<boolean> {
      if (!active || !state.available || state.saving) return false;
      const started = ++revision;
      const controller = new AbortController();
      controllers.add(controller);
      const selected = !state.reactions.some((row) => row.emoji === emoji && row.actorId === state.actorId);
      publish({ saving: true, error: null });
      try {
        const response = await request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji, selected }), signal: controller.signal });
        const receipt = response.ok ? parseReceipt(await response.json()) : null;
        if (!active || started !== revision) return false;
        if (!receipt) throw new Error("Invalid reaction receipt");
        publish(receipt);
        return true;
      } catch {
        if (active && started === revision) publish({ error: "Could not save your reaction. Try again." });
        return false;
      } finally {
        controllers.delete(controller);
        if (active && started === revision) publish({ saving: false });
      }
    },
    close() {
      active = false;
      revision++;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      publish({ saving: false });
    },
  };
}
