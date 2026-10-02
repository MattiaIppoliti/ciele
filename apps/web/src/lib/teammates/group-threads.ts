import type { ChatMsg } from "@/components/chat/chat-thread";

export interface GroupMessageThread {
  key: string;
  root: ChatMsg;
  replies: ChatMsg[];
}

/** Follow persisted chain links; truncated history promotes an orphan instead of hiding it. */
export function groupMessageThreads(messages: readonly ChatMsg[]): GroupMessageThread[] {
  const byId = new Map(messages.flatMap((message, index) => message.id ? [[message.id, index] as const] : []));
  const roots = messages.map((message, index) => {
    const seen = new Set([index]);
    let parentId = message.threadParentId;
    let root = index;
    while (parentId) {
      const parent = byId.get(parentId);
      if (parent === undefined) break;
      if (seen.has(parent)) return index;
      seen.add(parent);
      root = parent;
      parentId = messages[parent].threadParentId;
    }
    return root;
  });
  const threads = new Map<number, GroupMessageThread>();
  messages.forEach((message, index) => {
    const rootIndex = roots[index];
    const root = messages[rootIndex];
    let thread = threads.get(rootIndex);
    if (!thread) {
      thread = { key: root.id ?? `pending-${rootIndex}`, root, replies: [] };
      threads.set(rootIndex, thread);
    }
    if (index !== rootIndex) thread.replies.push(message);
  });
  return [...threads.values()];
}
