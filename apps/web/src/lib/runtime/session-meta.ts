import type { ConversationMetadata } from "@agent-hub/db";

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

/**
 * Best-effort session context from request headers for the Inbox details
 * panel. Location/city rely on proxy geo headers (Vercel/Cloudflare) and
 * are simply absent when running locally.
 */
export function sessionMetadata(headers: Headers): ConversationMetadata {
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
  const launchUrl = headers.get("referer") ?? headers.get("origin") ?? undefined;

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
