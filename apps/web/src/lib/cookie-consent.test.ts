import { describe, expect, it } from "vitest";
import {
  buildConsentConfig,
  CONSENT_CATEGORIES,
  CONSENT_COOKIE_DAYS,
  CONSENT_COOKIE_NAME,
  CONSENT_REVISION,
  COOKIE_NOTICE_PATH,
  findCategory,
  localStorageKeysFor,
  OPTIONAL_CATEGORIES,
  PRIVACY_POLICY_PATH,
  withdrawableKeys,
} from "./cookie-consent";

/**
 * These are compliance assertions, not style checks. A failure here means the
 * banner has stopped being lawful, treat it the way you would a failing
 * security test, not as a snapshot to update.
 */

const config = buildConsentConfig();
const english = config.language.translations.en;
const consentModal =
  typeof english === "object" && english !== null && "consentModal" in english
    ? english.consentModal
    : undefined;
const preferencesModal =
  typeof english === "object" && english !== null && "preferencesModal" in english
    ? english.preferencesModal
    : undefined;

describe("consent is opt-in", () => {
  it("runs in opt-in mode, so nothing optional is granted by default", () => {
    expect(config.mode).toBe("opt-in");
  });

  it("pre-ticks no optional category", () => {
    // The single most common way a consent banner is unlawful.
    for (const category of OPTIONAL_CATEGORIES) {
      const declared = config.categories[category.id];
      expect(declared, `category ${category.id} is missing from the config`).toBeDefined();
      expect(declared?.enabled, `${category.id} must start switched off`).toBe(false);
      expect(declared?.readOnly, `${category.id} must stay switchable`).not.toBe(true);
    }
  });

  it("keeps exactly one read-only category, and marks it enabled", () => {
    const essential = CONSENT_CATEGORIES.filter((category) => category.essential);
    expect(essential.map((category) => category.id)).toEqual(["necessary"]);
    expect(config.categories.necessary).toMatchObject({ enabled: true, readOnly: true });
  });

  it("declares at least one optional category, or the banner asks nothing", () => {
    expect(OPTIONAL_CATEGORIES.length).toBeGreaterThan(0);
  });
});

describe("refusing is as easy as accepting", () => {
  it("offers reject and accept together on the first layer", () => {
    expect(consentModal?.acceptAllBtn).toBeTruthy();
    expect(consentModal?.acceptNecessaryBtn).toBeTruthy();
  });

  it("gives the two buttons equal visual weight", () => {
    // `flipButtons` would put accept first; equal weight stops accept being
    // styled as the only real option.
    expect(config.guiOptions?.consentModal?.equalWeightButtons).toBe(true);
    expect(config.guiOptions?.preferencesModal?.equalWeightButtons).toBe(true);
  });

  it("offers reject inside the preferences layer too", () => {
    expect(preferencesModal?.acceptNecessaryBtn).toBeTruthy();
    expect(preferencesModal?.savePreferencesBtn).toBeTruthy();
  });

  it("does not use an ambiguous close-icon shortcut on the banner", () => {
    // An "X" that silently means "reject" (or worse, "accept") is not a clear
    // affirmative action either way.
    expect(consentModal).not.toHaveProperty("closeIconLabel");
  });

  it("never blocks the page behind the banner", () => {
    // A cookie wall makes consent coerced rather than freely given.
    expect(config.disablePageInteraction).toBe(false);
  });
});

describe("the banner informs before it asks", () => {
  it("states a title and a purpose", () => {
    expect(consentModal?.title).toBeTruthy();
    expect(consentModal?.description).toBeTruthy();
  });

  it("links the cookie notice and the privacy policy from the first layer", () => {
    expect(consentModal?.footer).toContain(COOKIE_NOTICE_PATH);
    expect(consentModal?.footer).toContain(PRIVACY_POLICY_PATH);
  });

  it("routes to granular controls rather than an all-or-nothing choice", () => {
    expect(consentModal?.showPreferencesBtn).toBeTruthy();
  });
});

describe("every category is disclosed granularly", () => {
  it("gives each declared category its own toggle in the preferences modal", () => {
    const linked = (preferencesModal?.sections ?? [])
      .map((section) => section.linkedCategory)
      .filter((id): id is string => typeof id === "string");
    expect(linked).toEqual(CONSENT_CATEGORIES.map((category) => category.id));
  });

  it("declares no category in the config that the notice does not describe", () => {
    // Catches the reverse drift: a category wired into the banner but absent
    // from the human-readable declaration the notice page renders.
    expect(Object.keys(config.categories).sort()).toEqual(
      CONSENT_CATEGORIES.map((category) => category.id).sort(),
    );
  });

  it("gives every category a purpose and a populated cookie table", () => {
    for (const section of preferencesModal?.sections ?? []) {
      if (!section.linkedCategory) continue;
      expect(section.title, "a toggled category needs a title").toBeTruthy();
      expect(section.description, `${section.linkedCategory} needs a purpose`).toBeTruthy();
      expect(
        section.cookieTable?.body.length,
        `${section.linkedCategory} must disclose what it sets`,
      ).toBeGreaterThan(0);
    }
  });

  it("describes every disclosed item fully", () => {
    for (const category of CONSENT_CATEGORIES) {
      for (const item of category.items) {
        expect(item.name).toBeTruthy();
        expect(item.provider, `${item.name} must name who serves it`).toBeTruthy();
        expect(item.purpose, `${item.name} must state a purpose`).toBeTruthy();
        expect(item.duration, `${item.name} must state a retention`).toBeTruthy();
      }
    }
  });

  it("discloses the consent cookie itself as strictly necessary", () => {
    const names = findCategory("necessary").items.map((item) => item.name);
    expect(names).toContain(CONSENT_COOKIE_NAME);
  });
});

describe("consent is recorded, time-boxed and revocable", () => {
  it("stores the choice under the declared name", () => {
    expect(config.cookie?.name).toBe(CONSENT_COOKIE_NAME);
  });

  it("expires consent within six months rather than persisting forever", () => {
    expect(config.cookie?.expiresAfterDays).toBe(CONSENT_COOKIE_DAYS);
    expect(CONSENT_COOKIE_DAYS).toBeLessThanOrEqual(183);
  });

  it("tracks a revision so a changed declaration re-asks everyone", () => {
    expect(CONSENT_REVISION).toBeGreaterThan(0);
    expect(config.revision).toBe(CONSENT_REVISION);
    expect(consentModal?.revisionMessage).toBeTruthy();
  });

  it("knows how to erase every local-storage item an optional category declares", () => {
    /* Withdrawal has to remove what was stored, not merely stop new writes.
       The plugin's `autoClear` only understands cookies, so any local-storage
       row needs machine-actionable keys or it would be silently left behind,
       which is exactly the bug this asserts against. */
    for (const category of OPTIONAL_CATEGORIES) {
      for (const item of category.items) {
        if (item.kind !== "Local storage") continue;
        expect(
          item.localStorageKeys?.length,
          `${category.id}/"${item.name}" is local storage but declares no key to clear`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("erases exactly the keys a withdrawn category owns, prefixes included", () => {
    const present = [
      "ciele-visitor",
      "preview-panel-collapsed",
      "ciele.local-connector.pairing.abc",
      "ciele.preview.ai-preferences.abc",
      "theme", // strictly necessary, must survive a functional withdrawal
      "unrelated-key",
    ];
    expect(withdrawableKeys("functional", present).sort()).toEqual([
      "ciele-visitor",
      "ciele.local-connector.pairing.abc",
      "ciele.preview.ai-preferences.abc",
      "preview-panel-collapsed",
    ]);
  });

  it("never reaches past the keys a category declared", () => {
    // A category with nothing stored must not clear anything.
    expect(withdrawableKeys("analytics", ["theme", "ciele-visitor"])).toEqual([]);
  });

  it("keeps the necessary category's storage out of every withdrawal sweep", () => {
    const necessaryKeys = localStorageKeysFor("necessary");
    expect(necessaryKeys).toContain("theme");
    for (const category of OPTIONAL_CATEGORIES) {
      expect(
        withdrawableKeys(category.id, necessaryKeys),
        `withdrawing ${category.id} must not erase strictly necessary storage`,
      ).toEqual([]);
    }
  });
});

describe("the banner presents as a small bottom-right card", () => {
  it("uses the box layout in the bottom-right corner", () => {
    expect(config.guiOptions?.consentModal?.layout).toBe("box");
    expect(config.guiOptions?.consentModal?.position).toBe("bottom right");
  });

  it("shows itself automatically and hides from crawlers", () => {
    expect(config.autoShow).toBe(true);
    expect(config.hideFromBots).toBe(true);
  });
});
