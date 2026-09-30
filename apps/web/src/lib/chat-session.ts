import type { ConversationMetadata } from "@agent-hub/core";

/**
 * Which Conversation the Teammates chat has open, and the one place every
 * surface that can change it goes through: the chat itself, the sidebar's New
 * chat and ⌘O (which sit above the chat, in the shell), the address bar's
 * `?c=`, and the sidebar's history.
 *
 * It used to be four holders that each knew part of the answer (the URL, the
 * chat's state, a ref, and the sidebar's list of reported rows), with a
 * module-level signal so the shell could reach the chat at all. The case that
 * broke them was New chat during a first message: there is no `?c=` to clear
 * yet, and a chat still answering must not reset under its own stream, so the
 * click has to wait for the answer and then apply.
 *
 * React-free, like `find-store`: one instance per tab (`chatSession`), read
 * through `useSyncExternalStore`, and tested without a DOM.
 */

/** One past thread in the sidebar's history, with the Teammate it belongs to. */
export interface SidebarConversation {
  id: string;
  teammateId: string;
  title: string;
  updatedAt: string;
  metadata?: ConversationMetadata | null;
}

export interface ChatSessionState {
  /** The open thread, or null for a new chat. */
  conversationId: string | null;
  /** A turn is answering. A reset now would be overwritten by its end. */
  busy: boolean;
  /** Bumps on every reset, which is the chat's cue to clear its transcript. */
  resets: number;
  /** Threads the chat reported since the chat area opened, newest first. */
  reported: readonly SidebarConversation[];
}

export interface ChatSession {
  getSnapshot(): ChatSessionState;
  subscribe(listener: () => void): () => void;
  /** New chat from anywhere. Applied now, or as soon as the running turn ends. */
  requestNewChat(): void;
  /** The chat opened a thread: from the history, a link, or its own turn's end. */
  opened(id: string): void;
  /** A turn started (or continued) this thread. Opens it and reports its row. */
  started(entry: SidebarConversation): void;
  /** A turn began or ended. Ending applies a queued New chat. */
  setBusy(busy: boolean): void;
  /**
   * What the address bar's `?c=` asks of the chat. Returns the id to open when
   * it names a thread other than the open one; a URL with no thread starts a
   * new chat. The chat's own writes to the URL name the open thread, so they
   * ask for nothing.
   */
  followUrl(urlConversationId: string | null): string | null;
  /** The chat unmounted. Nothing is open; the reported rows stay. */
  close(): void;
  /** The chat area closed. The reported rows go too. */
  leave(): void;
  /**
   * The server's history with the reported rows laid over it. A reported row
   * replaces the server's copy only when it is newer, so a reload never rolls
   * a thread back.
   */
  conversations(server: readonly SidebarConversation[]): SidebarConversation[];
}

export function createChatSession(): ChatSession {
  let state: ChatSessionState = { conversationId: null, busy: false, resets: 0, reported: [] };
  let queued = false;
  const listeners = new Set<() => void>();

  function set(patch: Partial<ChatSessionState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function reset() {
    queued = false;
    set({ conversationId: null, resets: state.resets + 1 });
  }

  function requestNewChat() {
    if (state.busy) queued = true;
    else reset();
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    requestNewChat,
    opened(id) {
      if (state.conversationId !== id) set({ conversationId: id });
    },
    started(entry) {
      set({
        conversationId: entry.id,
        reported: [entry, ...state.reported.filter((row) => row.id !== entry.id)],
      });
    },
    setBusy(busy) {
      if (busy === state.busy) return;
      set({ busy });
      if (!busy && queued) reset();
    },
    followUrl(urlConversationId) {
      if (urlConversationId) {
        return urlConversationId === state.conversationId ? null : urlConversationId;
      }
      if (state.conversationId) requestNewChat();
      return null;
    },
    close() {
      queued = false;
      set({ conversationId: null, busy: false });
    },
    leave() {
      queued = false;
      set({ conversationId: null, busy: false, reported: [] });
    },
    conversations(server) {
      const byId = new Map(server.map((entry) => [entry.id, entry]));
      for (const entry of state.reported) {
        const known = byId.get(entry.id);
        if (!known || known.updatedAt < entry.updatedAt) byId.set(entry.id, entry);
      }
      return [...byId.values()].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
    },
  };
}

/** The tab's one chat session. */
export const chatSession = createChatSession();
