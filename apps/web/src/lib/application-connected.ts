/**
 * The message the OAuth callback's completion page posts to the window that
 * opened it. Spelled once: the callback route emits it and
 * `useApplicationConnected` listens for it, so the two cannot drift apart.
 */
export const APPLICATION_CONNECTED_MESSAGE = "ciele:application-connected";

/** The payload behind {@link APPLICATION_CONNECTED_MESSAGE}. */
export interface ApplicationConnectedMessage {
  type: typeof APPLICATION_CONNECTED_MESSAGE;
  provider: string;
}

/**
 * Whether a `message` event is the callback page reporting a completed
 * connection. Same origin only: the popup is ours, and anything else posting
 * to this window is noise.
 */
export function isApplicationConnectedMessage(
  event: Pick<MessageEvent, "origin" | "data">,
  origin: string
): event is MessageEvent<ApplicationConnectedMessage> {
  return (
    event.origin === origin &&
    typeof event.data === "object" &&
    event.data !== null &&
    (event.data as { type?: unknown }).type === APPLICATION_CONNECTED_MESSAGE
  );
}
