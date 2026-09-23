import * as cheerio from "cheerio";
import type { CrawledPage, CrawlOptions } from "./apify";
import {
  EgressPolicyError,
  validateEgressTarget,
  type ValidatedEgressTarget,
} from "./egress";
import { pinnedRequest, type PinnedFetchResponse } from "./pinned-fetch";

/**
 * Built-in Website Source crawler: a same-origin BFS over pinned HTTP + cheerio.
 * It can be selected explicitly or by Automatic when Apify is unavailable.
 * It performs no JavaScript rendering, file downloads, or authenticated crawl.
 */

/** Marker stored as the Source's crawlRunId for locally crawled Sources. */
export const LOCAL_CRAWL_RUN = "local";

/**
 * Hard page ceiling for the in-process crawler; it runs inline in the server
 * process (seconds, not minutes), so its budget is clamped tighter than the
 * remote providers'. The Automatic policy treats a requested budget above this
 * as a "larger" crawl that a remote provider must handle.
 */
export const LOCAL_CRAWL_MAX_PAGES = 30;
const USER_AGENT =
  "Mozilla/5.0 (compatible; AgentHubCrawler/1.0; +https://ciele.app)";
const MAX_REDIRECTS = 5;
const LOCAL_TOTAL_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * Whether a redirect from `from` to `to` stays on the same site: the same
 * host give or take a leading `www.`, the same port, and a scheme that stays
 * put or upgrades from http to https. `example.com → www.example.com` and
 * `http → https` are how ordinary sites canonicalize the address an admin
 * types; another domain, another subdomain, a port change or an https
 * downgrade is still a cross-origin redirect.
 */
export function isSameSiteRedirect(from: URL, to: URL): boolean {
  const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
  if (bare(from.hostname) !== bare(to.hostname)) return false;
  if (from.port !== to.port) return false;
  return (
    from.protocol === to.protocol ||
    (from.protocol === "http:" && to.protocol === "https:")
  );
}

/** Where the crawl is allowed to go: one origin, pinned to its vetted addresses. */
interface CrawlScope {
  origin: string;
  addresses: string[];
}

/**
 * Fetches one page, following redirects by hand so each hop is re-validated.
 * A hop that leaves `scope.origin` is refused, with one exception: while
 * fetching the **start** page (`adoptSameSite`), a same-site redirect moves
 * the scope to the canonical origin and its own vetted addresses. That is the
 * whole difference between `https://example.com` failing and crawling
 * `https://www.example.com`; the rest of the crawl stays on the adopted origin.
 */
async function fetchCrawlPage(
  rawUrl: string,
  scope: CrawlScope,
  timeoutMs: number,
  adoptSameSite: boolean
): Promise<{ response: PinnedFetchResponse; finalUrl: string }> {
  let currentUrl = rawUrl;
  let previous: URL | null = null;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const validated = await validateEgressTarget(currentUrl);
    if (validated.url.origin !== scope.origin) {
      if (!adoptSameSite || !previous || !isSameSiteRedirect(previous, validated.url)) {
        throw new EgressPolicyError(
          "Local crawls cannot follow a cross-origin redirect",
          "redirect"
        );
      }
      scope.origin = validated.url.origin;
      scope.addresses = validated.addresses;
    }
    const pinnedTarget: ValidatedEgressTarget = {
      url: validated.url,
      addresses: scope.addresses,
    };
    const response = await pinnedRequest(pinnedTarget, {
      timeoutMs,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: validated.url.toString() };
    }
    const location = response.headers.get("location");
    if (!location) return { response, finalUrl: validated.url.toString() };
    previous = validated.url;
    currentUrl = new URL(location, validated.url).toString();
  }
  throw new Error(`Too many redirects while crawling ${rawUrl}`);
}

/** Minimal glob → RegExp: `*` matches anything, the rest is literal. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function urlAllowed(url: string, options: CrawlOptions): boolean {
  const include = (options.includeGlobs ?? []).filter(Boolean);
  const exclude = (options.excludeGlobs ?? []).filter(Boolean);
  if (exclude.some((g) => globToRegExp(g).test(url))) return false;
  if (include.length > 0) return include.some((g) => globToRegExp(g).test(url));
  return true;
}

/** Strips hash + trailing slash so the same page isn't crawled twice. */
function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = ""; // query strings stay; they can be distinct pages
  let s = url.toString();
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

/** File extensions that are never HTML pages worth queueing. */
const SKIP_EXTENSIONS =
  /\.(pdf|zip|rar|7z|png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|rss|mp[34]|wav|avi|mov|webm|woff2?|ttf|eot|docx?|xlsx?|pptx?)$/i;

export function extractPage(
  html: string,
  url: string
): { page: CrawledPage | null; links: string[] } {
  const $ = cheerio.load(html);
  // Drop non-content chrome before extraction. Semantic tags + ARIA landmark
  // roles keep false positives low (no fragile class-name guessing); the local
  // crawler renders no JS, so anything it can strip here is genuine boilerplate.
  $(
    "script, style, noscript, svg, iframe, nav, footer, header, form, aside," +
      '[role="navigation"], [role="banner"], [role="contentinfo"],' +
      '[role="search"], [aria-hidden="true"]'
  ).remove();

  const title =
    $("title").first().text().trim() ||
    $("h1").first().text().trim() ||
    url;
  const text = ($("main").text().trim() ? $("main").text() : $("body").text())
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const absolute = new URL(href, url);
      if (absolute.protocol !== "http:" && absolute.protocol !== "https:") return;
      if (SKIP_EXTENSIONS.test(absolute.pathname)) return;
      links.push(absolute.toString());
    } catch {
      /* unparseable href */
    }
  });

  return {
    page: text ? { url, title, text } : null,
    links,
  };
}

/**
 * Crawls `startUrl` and same-origin pages it links to, breadth-first, up to
 * maxPages. Runs inline in the server process (seconds, not minutes), so the
 * page budget is clamped tighter than Apify's.
 */
export async function localCrawl(
  startUrl: string,
  options: CrawlOptions = {}
): Promise<CrawledPage[]> {
  const maxPages = Math.min(options.maxPages ?? 20, LOCAL_CRAWL_MAX_PAGES);
  const timeoutMs = (options.pageTimeoutSecs ?? 15) * 1000;
  const initialTarget = await validateEgressTarget(startUrl);
  const scope: CrawlScope = {
    origin: initialTarget.url.origin,
    addresses: initialTarget.addresses,
  };
  const deadline = Date.now() + LOCAL_TOTAL_TIMEOUT_MS;

  const queue: string[] = [startUrl];
  const seen = new Set<string>([normalizeUrl(startUrl)]);
  const pages: CrawledPage[] = [];

  while (
    queue.length > 0 &&
    pages.length < maxPages &&
    Date.now() < deadline
  ) {
    const url = queue.shift()!;
    try {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const { response, finalUrl } = await fetchCrawlPage(
        url,
        scope,
        Math.min(timeoutMs, remainingMs),
        url === startUrl
      );
      if (!response.ok) continue;
      const type = response.headers.get("content-type") ?? "";
      if (!type.includes("html")) continue;

      const { page, links } = extractPage(response.text, finalUrl);
      if (page && urlAllowed(finalUrl, options)) pages.push(page);

      for (const link of links) {
        if (new URL(link).origin !== scope.origin) continue;
        const normalized = normalizeUrl(link);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        if (seen.size > maxPages * 10) continue; // frontier cap
        queue.push(link);
      }

      if (options.throttle) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      if (error instanceof EgressPolicyError) throw error;
      // Unreachable page: skip it; the crawl continues.
    }
  }

  return pages;
}
