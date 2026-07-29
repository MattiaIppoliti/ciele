import type { ConversationMetadata } from "@agent-hub/core";

function parseOs(ua: string): string | undefined {
  if (/windows/i.test(ua)) return "Windows";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/iphone|ipad|ios/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/linux/i.test(ua)) return "Linux";
  return undefined;
}

function parseBrowser(ua: string): string | undefined {
  if (/edg\//i.test(ua)) return "Microsoft Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/chrome|crios/i.test(ua)) return "Google Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return undefined;
}

/** Longest launch URL we store. Matches the consent log's page-URL cap. */
const LAUNCH_URL_LIMIT = 500;

/**
 * A page URL reported by the embed, or undefined when it is unusable.
 *
 * The floater launcher runs on the customer's page and the chat runs in an
 * iframe on our origin, so `referer` describes *us*, not the visitor's page —
 * which is why the embed has to say. Only http(s) is accepted, so a hostile
 * embed cannot park a `javascript:` string in a field the Inbox renders.
 */
function reportedPageUrl(pageUrl: string | undefined): string | undefined {
  const raw = (pageUrl ?? "").trim();
  if (!raw || raw.length > LAUNCH_URL_LIMIT) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return raw;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort session context from request headers for the Inbox details
 * panel. Location/city rely on proxy geo headers (Vercel/Cloudflare) and
 * are simply absent when running locally.
 *
 * `pageUrl` is the embedding page as reported by the embed; it wins over the
 * header-derived value, which stays the fallback for embeds that cannot supply
 * one (direct iframe, pop-up). URL Flow Conditions are evaluated against
 * whichever of the two lands here (spec #550).
 */
export function sessionMetadata(
  headers: Headers,
  pageUrl?: string
): ConversationMetadata {
  const ua = headers.get("user-agent") ?? "";
  const language = headers.get("accept-language")?.split(",")[0]?.trim();
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    undefined;
  const location =
    headers.get("x-vercel-ip-country") ??
    headers.get("cf-ipcountry") ??
    undefined;
  const rawCity =
    headers.get("x-vercel-ip-city") ?? headers.get("cf-ipcity") ?? undefined;
  const launchUrl =
    reportedPageUrl(pageUrl) ??
    headers.get("referer") ??
    headers.get("origin") ??
    undefined;

  return {
    launchUrl,
    ip,
    os: parseOs(ua),
    browser: parseBrowser(ua),
    language: language || undefined,
    location: location || undefined,
    city: rawCity ? decodeURIComponent(rawCity) : undefined,
  };
}
