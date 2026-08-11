// What the app knows about the local stack once setup is done.

export type StackHealth =
  /** Docker itself is unavailable, so nothing can be said about the stack. */
  | "docker-unavailable"
  /** Containers are down. */
  | "stopped"
  /** Containers are up but Ciele is not answering yet. */
  | "starting"
  /** Ciele answers. */
  | "running";

export interface StackStatus {
  health: StackHealth;
  /** Where the local product serves, for the "Open Ciele" action. */
  url: string;
  /** Where the generated configuration and state live. */
  dataDir: string;
  /**
   * Release tag the stack is pinned to. Null on a build the release workflow
   * never stamped, which has no published images to point at.
   */
  imageTag: string | null;
  /** Last error from a start or stop, if one failed. */
  error: string | null;
  /** True while a start or stop is in flight. */
  busy: boolean;
}

export interface StackBridge {
  stack: {
    status(): Promise<StackStatus>;
    onStatus(listener: (status: StackStatus) => void): () => void;
    start(): Promise<StackStatus>;
    stop(): Promise<StackStatus>;
  };
}

export const STACK_CHANNELS = {
  status: "ciele:stack:status",
  statusChanged: "ciele:stack:status-changed",
  start: "ciele:stack:start",
  stop: "ciele:stack:stop",
} as const;
