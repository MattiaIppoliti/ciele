/**
 * Turn Session: the runtime's view of a conversation's persistent cross-turn
 * state (tau-style sessions). A Conversation already persists its transcript;
 * this is the *working state* that isn't a message: facts the `remember` tool
 * saved, anything a tool wants to find again next turn.
 *
 * The seam is deliberately narrow: turn.ts loads `conversations.session_state`
 * into a TurnSession before running the engine, tools mutate it through
 * `remember`, and turn.ts writes it back after the assistant message is
 * persisted, only when something actually changed (`dirty`), so read-only
 * turns cost no extra write. The generic `get`/`set` pair exists for runtime
 * state that rides the same bag without being memory: the proactive
 * delivery-rule patches and the graph QA map (turn.ts) both use it.
 */

const MEMORY_KEY = "memory";
const MEMORY_CAP = 20;
/**
 * One cap for a remembered fact, session AND long-term: the promotion job
 * (memories.ts) copies session facts into the durable store, so two different
 * caps would truncate on promotion.
 */
export const MEMORY_FACT_MAX = 500;

export interface TurnSession {
  conversationId: string;
  /** True once any tool mutated the state this turn. */
  readonly dirty: boolean;
  /** Appends a fact to the session memory (capped, deduped). */
  remember(fact: string): void;
  /** The remembered facts, oldest first. */
  memory(): string[];
  /** Reads an arbitrary state key (undefined if unset). */
  get(key: string): unknown;
  /** Sets an arbitrary state key and marks the session dirty. */
  set(key: string, value: unknown): void;
  /** The state to persist (only meaningful when `dirty`). */
  snapshot(): Record<string, unknown>;
}

export function createTurnSession(
  conversationId: string,
  initial: Record<string, unknown>
): TurnSession {
  const state: Record<string, unknown> = { ...initial };
  let dirty = false;

  const memory = (): string[] => {
    const value = state[MEMORY_KEY];
    return Array.isArray(value)
      ? value.filter((f): f is string => typeof f === "string")
      : [];
  };

  return {
    conversationId,
    get dirty() {
      return dirty;
    },
    remember(fact) {
      const trimmed = fact.trim().slice(0, MEMORY_FACT_MAX);
      if (!trimmed) return;
      const facts = memory();
      if (facts.includes(trimmed)) return;
      state[MEMORY_KEY] = [...facts, trimmed].slice(-MEMORY_CAP);
      dirty = true;
    },
    memory,
    get(key) {
      return state[key];
    },
    set(key, value) {
      state[key] = value;
      dirty = true;
    },
    snapshot() {
      return { ...state };
    },
  };
}
