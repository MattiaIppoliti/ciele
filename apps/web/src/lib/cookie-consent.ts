/**
 * The cookie declaration and the consent-banner configuration.
 *
 * One source of truth, two consumers: the preferences modal built by
 * `buildConsentConfig()` and the public Cookie Notice page
 * (`/policies/cookies`), which renders the same tables. Adding a cookie in one
 * place therefore discloses it in both — the two can never drift, which is the
 * failure mode that makes a cookie notice legally worthless.
 *
 * GDPR/ePrivacy invariants this module encodes (locked by cookie-consent.test.ts):
 *
 * - Opt-in. Nothing beyond the strictly necessary category runs before the
 *   visitor chooses; no non-essential category is pre-ticked.
 * - Rejecting is exactly as easy as accepting — "Reject all" sits next to
 *   "Accept all" on the first layer, same visual weight, no extra click.
 * - Granular. Every category the visitor can control is a separate toggle with
 *   its own purpose and cookie table.
 * - Withdrawable. `/policies/cookies` and the site footer reopen the modal, so
 *   consent can be changed or withdrawn as easily as it was given.
 * - Provable. The consent cookie stores a consent id plus grant/change
 *   timestamps, which is the record we would have to produce on request.
 * - Time-boxed. Consent expires after CONSENT_COOKIE_DAYS rather than
 *   persisting indefinitely, and bumping CONSENT_REVISION re-asks everyone.
 */

import type { CookieConsentConfig } from "vanilla-cookieconsent";

/**
 * Categories a visitor can act on. `necessary` is present but read-only — it
 * is listed for transparency, not as a choice.
 *
 * There is deliberately no `marketing` category: nothing on ciele.app serves
 * advertising or cross-site tracking storage, and declaring a category we do
 * not use would misstate what we do. Adding one later means appending an entry
 * here — the banner, the modal and the notice page all pick it up.
 */
export type ConsentCategoryId = "necessary" | "functional" | "analytics";

/** How a single item is stored on the visitor's device. */
export type StorageKind = "Cookie" | "Local storage";

export interface DeclaredItem {
  /** Cookie name or storage key, as it appears on the device. */
  name: string;
  /** Who sets it — us, or the named third party acting for us. */
  provider: string;
  purpose: string;
  /** Plain-language lifetime, e.g. "Session" or "6 months". */
  duration: string;
  kind: StorageKind;
  /**
   * Exact local-storage keys this row covers, for clearing on withdrawal.
   * `name` is prose meant for a human reading the notice, so it cannot be used
   * as a key. The plugin's own `autoClear` only understands cookies, so
   * anything stored in local storage has to be listed here or withdrawal
   * silently leaves it behind. A trailing "." means "this prefix and anything
   * scoped under it".
   */
  localStorageKeys?: string[];
}

export interface ConsentCategory {
  id: ConsentCategoryId;
  /** Heading used in the preferences modal and the notice page. */
  title: string;
  /** Why this category exists, in the visitor's terms. */
  description: string;
  /**
   * True only for the category that cannot be switched off because the service
   * cannot be delivered without it.
   */
  essential: boolean;
  items: DeclaredItem[];
}

/** Name of the cookie holding the consent record itself. */
export const CONSENT_COOKIE_NAME = "cc_cookie";

/**
 * 182 days ≈ 6 months. Consent is not open-ended: this is the ceiling
 * regulators (CNIL among them) point to for how long a choice may be reused
 * before asking again.
 */
export const CONSENT_COOKIE_DAYS = 182;

/**
 * Bump this whenever the declaration below changes materially — a new category,
 * a new third party, a new purpose. Every visitor is then asked again, because
 * consent given to the old declaration does not cover the new one.
 */
export const CONSENT_REVISION = 1;

/** Where the full notice lives. Linked from the banner's first layer. */
export const COOKIE_NOTICE_PATH = "/policies/cookies";
export const PRIVACY_POLICY_PATH = "/policies/privacy";

/** The date shown on the notice page; keep in step with CONSENT_REVISION. */
export const COOKIE_NOTICE_LAST_UPDATED = "July 26, 2026";

export const CONSENT_CATEGORIES: ConsentCategory[] = [
  {
    id: "necessary",
    title: "Strictly necessary",
    essential: true,
    description:
      "Required to run the site and keep it secure, signing you in, keeping your session on the right organization, and remembering this cookie choice. They set no advertising or cross-site identifiers, so they stay on and cannot be switched off. Blocking them in your browser will break parts of the product.",
    items: [
      {
        name: "sb-<project>-auth-token",
        provider: "Ciele (Supabase Auth)",
        purpose:
          "Keeps you signed in to the console and identifies your session on each request.",
        duration: "1 year, refreshed while you stay active",
        kind: "Cookie",
      },
      {
        name: "active_org_id",
        provider: "Ciele",
        purpose:
          "Remembers which organization you are working in when you belong to more than one.",
        duration: "Session",
        kind: "Cookie",
      },
      {
        name: "sso_txn",
        provider: "Ciele",
        purpose:
          "Encrypted, single-use token that protects one sign-in exchange with your identity provider against replay.",
        duration: "10 minutes",
        kind: "Cookie",
      },
      {
        name: "sso_gate",
        provider: "Ciele",
        purpose:
          "Encrypted proof that you completed sign-in for an assistant that requires an account.",
        duration: "12 hours",
        kind: "Cookie",
      },
      {
        name: CONSENT_COOKIE_NAME,
        provider: "Ciele",
        purpose:
          "Stores the choice you make here: the categories you allowed, when you chose, and a random consent id. We also keep our own copy of that record on our servers so we can show what you agreed to, see “Our record of your choice” below.",
        duration: `${CONSENT_COOKIE_DAYS} days`,
        kind: "Cookie",
        localStorageKeys: [],
      },
      {
        name: "theme",
        provider: "Ciele",
        purpose:
          "Remembers whether you chose the light or dark interface, so the page does not load in the wrong one. Set only because you asked for it, and holds no identifier.",
        duration: "Until you clear it",
        kind: "Local storage",
        localStorageKeys: ["theme"],
      },
      {
        name: "_vercel_jwt, __vercel_live_token",
        provider: "Vercel (our hosting provider)",
        purpose:
          "Controls access to protected and preview deployments. Set by our host on the deployments it guards, not on the public site.",
        duration: "Session",
        kind: "Cookie",
      },
    ],
  },
  {
    id: "functional",
    title: "Functional",
    essential: false,
    description:
      "Remember optional choices and let an embedded Ciele assistant pick a conversation back up where you left it. Turning these off does not stop you using the site, an assistant will simply start fresh each time, and some layout choices will not stick.",
    items: [
      {
        name: "ciele-visitor",
        provider: "Ciele",
        purpose:
          "A random id that lets an embedded assistant keep one conversation continuous across page loads. Not linked to an account and not used to profile you or track you across other sites.",
        duration: "Until you clear it",
        kind: "Local storage",
        localStorageKeys: ["ciele-visitor"],
      },
      {
        name: "preview-panel-collapsed",
        provider: "Ciele",
        purpose:
          "Remembers whether you collapsed the assistant preview panel in the console, so it opens the way you left it.",
        duration: "Until you clear it",
        kind: "Local storage",
        localStorageKeys: ["preview-panel-collapsed"],
      },
      {
        name: "ciele.local-connector.*, ciele.preview.ai-preferences.*",
        provider: "Ciele",
        purpose:
          "If you pair a local connector, keeps that pairing and its preview model preferences on this device so you do not have to set them up again. Only written once you use that feature.",
        duration: "Until you clear it",
        kind: "Local storage",
        localStorageKeys: ["ciele.local-connector.", "ciele.preview.ai-preferences."],
      },
    ],
  },
  {
    id: "analytics",
    title: "Analytics",
    essential: false,
    description:
      "Let us count visits and measure page performance so we can see which pages matter and what is slow. The measurements are aggregated and we cannot use them to identify you. With these off we simply do not receive the measurement.",
    items: [
      {
        name: "No cookie set",
        provider: "Vercel Web Analytics",
        purpose:
          "Counts page views and referrers in aggregate. Cookieless by design, it stores nothing on your device, but we still ask first and load it only if you allow this category.",
        duration: "Not stored on your device",
        kind: "Cookie",
      },
      {
        name: "No cookie set",
        provider: "Vercel Speed Insights",
        purpose:
          "Reports anonymous page-performance timings (such as how long a page took to become usable) so we can fix slow pages.",
        duration: "Not stored on your device",
        kind: "Cookie",
      },
    ],
  },
];

/** The categories a visitor can actually switch, in display order. */
export const OPTIONAL_CATEGORIES: ConsentCategory[] = CONSENT_CATEGORIES.filter(
  (category) => !category.essential,
);

export function findCategory(id: ConsentCategoryId): ConsentCategory {
  const category = CONSENT_CATEGORIES.find((entry) => entry.id === id);
  if (!category) throw new Error(`Unknown consent category: ${id}`);
  return category;
}

/**
 * Every local-storage key a category is allowed to write. Keys ending in "."
 * are prefixes covering anything scoped under them.
 */
export function localStorageKeysFor(id: ConsentCategoryId): string[] {
  return findCategory(id).items.flatMap((item) => item.localStorageKeys ?? []);
}

/**
 * Picks the keys present in `existingKeys` that a withdrawn category owns.
 *
 * Withdrawal has to remove what a category stored, not merely stop new writes —
 * otherwise the identifier survives the refusal. Pure and key-list-driven so the
 * matching (including the prefix rule) is testable without a browser, and so it
 * can never reach past the keys the category actually declared.
 */
export function withdrawableKeys(
  id: ConsentCategoryId,
  existingKeys: string[],
): string[] {
  const owned = localStorageKeysFor(id);
  return existingKeys.filter((key) =>
    owned.some((pattern) =>
      pattern.endsWith(".") ? key.startsWith(pattern) : key === pattern,
    ),
  );
}

/** Column headings for the per-category cookie tables. */
export const COOKIE_TABLE_HEADERS = {
  name: "Name",
  provider: "Served by",
  purpose: "Purpose",
  duration: "Retention",
  kind: "Type",
} as const;

function cookieTable(category: ConsentCategory) {
  return {
    headers: { ...COOKIE_TABLE_HEADERS },
    body: category.items.map((item) => ({
      name: item.name,
      provider: item.provider,
      purpose: item.purpose,
      duration: item.duration,
      kind: item.kind,
    })),
  };
}

/**
 * Builds the runtime configuration for the consent plugin.
 *
 * Kept as a pure function of the declaration above so the compliance
 * properties are assertable in a plain unit test without a DOM.
 */
export function buildConsentConfig(): CookieConsentConfig {
  return {
    // `opt-in` is the whole point: until the visitor chooses, only the
    // read-only necessary category counts as granted.
    mode: "opt-in",
    revision: CONSENT_REVISION,
    autoShow: true,
    // No cookie wall. The banner never blocks reading the page — consent has
    // to be freely given, and trapping the page behind it is coercive.
    disablePageInteraction: false,
    hideFromBots: true,

    cookie: {
      name: CONSENT_COOKIE_NAME,
      expiresAfterDays: CONSENT_COOKIE_DAYS,
      sameSite: "Lax",
      path: "/",
    },

    guiOptions: {
      // Small card, bottom right — the same corner and radius language as the
      // rest of the product's floating surfaces.
      consentModal: {
        layout: "box",
        position: "bottom right",
        equalWeightButtons: true,
        flipButtons: false,
      },
      preferencesModal: {
        layout: "box",
        equalWeightButtons: true,
        flipButtons: false,
      },
    },

    categories: {
      necessary: { enabled: true, readOnly: true },
      // Both start disabled. Under `opt-in` an omitted `enabled` is already
      // false, but stating it makes the no-pre-ticked-boxes rule explicit and
      // testable rather than a default nobody notices.
      // Everything these two categories persist lives in local storage, which
      // the plugin's `autoClear` cannot touch — it only erases cookies. The
      // clearing is done from the mount instead, driven by the
      // `localStorageKeys` in the declaration above; see `withdrawableKeys`.
      functional: { enabled: false },
      analytics: { enabled: false },
    },

    language: {
      default: "en",
      translations: {
        en: {
          consentModal: {
            label: "Cookie notice",
            title: "Cookies on ciele.app",
            description:
              "We use strictly necessary cookies to run this site. We would also like to set optional cookies to measure performance and remember your choices, only if you agree.",
            acceptAllBtn: "Accept all",
            acceptNecessaryBtn: "Reject all",
            showPreferencesBtn: "Manage preferences",
            // Deliberately no `closeIconLabel`: an "X" that silently means
            // "reject" is ambiguous, and the two explicit buttons already give
            // an equally easy way to decline.
            revisionMessage:
              "Our cookie notice has changed since you last chose, so we are asking again.",
            footer: `<a href="${COOKIE_NOTICE_PATH}">Cookie Notice</a><a href="${PRIVACY_POLICY_PATH}">Privacy Policy</a>`,
          },
          preferencesModal: {
            title: "Cookie preferences",
            acceptAllBtn: "Accept all",
            acceptNecessaryBtn: "Reject all",
            savePreferencesBtn: "Save my choices",
            closeIconLabel: "Close",
            serviceCounterLabel: "Service|Services",
            sections: [
              {
                description:
                  "Choose which optional cookies we may set. Strictly necessary cookies are always on because the site cannot work without them. You can come back and change or withdraw any of this at any time from the Cookie Notice or the link in our footer.",
              },
              ...CONSENT_CATEGORIES.map((category) => ({
                title: category.title,
                description: category.description,
                linkedCategory: category.id,
                cookieTable: cookieTable(category),
              })),
              {
                title: "Our record of your choice",
                description: `Whichever way you decide, we keep a record of it on our servers, the categories you picked, the version of the notice you were shown and when, so we can demonstrate what you agreed to. It holds a random consent id rather than your identity, and no IP address. <a href="${COOKIE_NOTICE_PATH}#consent-record">What the record contains</a>.`,
              },
              {
                title: "More information",
                description: `Full detail, including how to control cookies in your browser, is in our <a href="${COOKIE_NOTICE_PATH}">Cookie Notice</a>. For anything else, email <a href="mailto:privacy@ciele.app">privacy@ciele.app</a>.`,
              },
            ],
          },
        },
      },
    },
  };
}
