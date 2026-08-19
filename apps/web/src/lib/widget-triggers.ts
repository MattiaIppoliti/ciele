/**
 * Client-side rules for reporting proactive Flow triggers (#541).
 *
 * The widget only *reports* events, which Flows run and whether a nudge is
 * delivered are decided server-side (see the trigger route). What has to be
 * decided in the browser is narrower: *when* an event has happened at all. That
 * lives here rather than in the component so it is testable, this app's vitest
 * collects `.ts` only.
 */

/** Query flag the floater script (`widget.js`) adds to the chat iframe's src. */
export const LAUNCHER_PARAM = "launcher";

/**
 * Whether "chat opens" has already happened by the time the widget mounts.
 *
 * Inside our floater the chat is mounted long before it is shown, the script
 * warms the iframe on idle, so opening is an event the script reports with a
 * `ciele:open` message. Every other embedding (the iFrame publish option, the
 * standalone widget page, a docs drawer) renders the chat visible immediately,
 * and for those mounting *is* opening.
 */
export function chatOpenFiresOnMount(search: URLSearchParams): boolean {
  return search.get(LAUNCHER_PARAM) !== "1";
}

/** Proactive triggers the widget can report. */
export type ReportableTrigger = "page_load" | "time_on_page" | "chat_open";

const REPORTABLE: ReportableTrigger[] = ["page_load", "time_on_page", "chat_open"];

/** One event the floater script reports into the chat frame. */
export interface TriggerReport {
  trigger: ReportableTrigger;
  /** The host page's URL, the chat frame cannot read it cross-origin. */
  url?: string;
  /** Seconds spent on the page, for a dwell report. */
  elapsedSeconds?: number;
}

/**
 * Key a report is deduplicated by within one mount. Dwell reports are keyed by
 * their threshold, because an assistant may configure several: firing the 10s
 * nudge must not swallow the 2m one.
 */
export function triggerReportKey(report: TriggerReport): string {
  return report.elapsedSeconds !== undefined
    ? `${report.trigger}:${report.elapsedSeconds}`
    : report.trigger;
}

/**
 * Reads a floater trigger message, or null for anything else on the bus.
 *
 * The frame shares its message channel with theme sync, SSO callbacks and the
 * host page's own traffic, so an unrecognised shape must be ignored rather than
 * guessed at; this is untrusted input from whatever page embedded us. The
 * trigger name is only a claim: the server re-decides what (if anything) runs.
 */
export function readTriggerMessage(data: unknown): TriggerReport | null {
  if (!data || typeof data !== "object") return null;
  const message = data as {
    type?: unknown;
    trigger?: unknown;
    url?: unknown;
    elapsedSeconds?: unknown;
  };
  if (message.type !== "ciele:trigger") return null;
  const trigger = REPORTABLE.find((t) => t === message.trigger);
  if (!trigger) return null;
  const elapsed = message.elapsedSeconds;
  return {
    trigger,
    ...(typeof message.url === "string" && message.url ? { url: message.url } : {}),
    ...(typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed >= 0
      ? { elapsedSeconds: Math.floor(elapsed) }
      : {}),
  };
}

/** Told to the host so a closed launcher can badge itself. */
export const UNREAD_MESSAGE = "ciele:unread";

/**
 * A reported host-page URL, or undefined if it is not one we would store.
 *
 * The value comes from whatever page embedded the widget, and it ends up in the
 * Conversation's session context where the Inbox displays it, so only absolute
 * http(s) URLs are kept. A `javascript:` or `data:` string is not a page address.
 */
export function reportedPageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
