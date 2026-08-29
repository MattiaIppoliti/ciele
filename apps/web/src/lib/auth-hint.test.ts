import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUTH_HINT_ATTR,
  AUTH_HINT_COOKIE,
  AUTH_HINT_INIT,
  authHintIsCurrent,
} from "./auth-hint";

/**
 * The one behaviour the whole prerendering change rests on: the marketing header
 * shows "Open app" to a signed-in visitor and "Log in / Get a demo" to everyone
 * else. That used to be a server-side branch on a resolved Session, which a test
 * could reach by calling a function. It is now a three-part contract with no
 * single function in it, middleware writes a cookie, an inline script copies it
 * onto <html>, and CSS reveals one of two CTA sets keyed on that attribute, and
 * two of those three parts are a `.tsx` component and a stylesheet, neither of
 * which this suite collects (`apps/web/CLAUDE.md`: vitest takes `.test.ts` only).
 *
 * So the parts that *are* plain TS are tested directly, and the two that are not
 * are pinned against their source with the exported constants. That means
 * renaming the attribute or a class in TypeScript, or deleting a rule from the
 * stylesheet, fails here rather than silently showing every visitor the wrong
 * button. The middleware side of the contract, when the cookie is written,
 * cleared, and deliberately not rewritten, is covered in `middleware.test.ts`.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const HOME_CSS = read("../app/(marketing)/home.css");
const HEADER = read("../components/home/home-header.tsx");

/** The two wrappers the header renders around each CTA set. */
const AUTHED_CLASS = "home-cta-authed";
const ANON_CLASS = "home-cta-anon";

/**
 * Run the blocking inline script against a stub document and report what it did
 * to <html>. Node env, so there is no real DOM: the script only touches
 * `document.cookie` and `documentElement.setAttribute`, which is the whole
 * surface it is allowed to touch.
 */
function runInitScript(cookie: string | (() => never)): string | null {
  let attribute: string | null = null;
  const documentStub = {
    get cookie() {
      // A getter that throws stands in for a browser that refuses cookie access
      // (a sandboxed iframe, a hardened privacy mode).
      return typeof cookie === "function" ? cookie() : cookie;
    },
    documentElement: {
      setAttribute(name: string, value: string) {
        if (name === AUTH_HINT_ATTR) attribute = value;
      },
    },
  };
  new Function("document", AUTH_HINT_INIT)(documentStub);
  return attribute;
}

describe("signed-in hint script", () => {
  it("marks <html> when the hint cookie is set, so the signed-in CTA shows", () => {
    expect(runInitScript(`${AUTH_HINT_COOKIE}=1`)).toBe("");
  });

  it("finds the cookie among others, whatever its position", () => {
    expect(runInitScript(`theme=dark; ${AUTH_HINT_COOKIE}=1; sb-access-token=x`)).toBe("");
    expect(runInitScript(`${AUTH_HINT_COOKIE}=1; theme=dark`)).toBe("");
    expect(runInitScript(`theme=dark; ${AUTH_HINT_COOKIE}=1`)).toBe("");
  });

  it("leaves <html> alone with no cookies at all, the signed-out default", () => {
    expect(runInitScript("")).toBeNull();
    expect(runInitScript("theme=dark")).toBeNull();
  });

  it("is not fooled by a cookie whose name merely ends in the hint's", () => {
    // Matching a substring rather than a whole `name=value` pair would let any
    // site-set cookie forge the signed-in look.
    expect(runInitScript(`not_${AUTH_HINT_COOKIE}=1`)).toBeNull();
    expect(runInitScript(`${AUTH_HINT_COOKIE}_other=1`)).toBeNull();
  });

  it("treats any value but 1 as signed out", () => {
    // The middleware writes "1" or deletes the cookie; anything else came from
    // somewhere else and must not read as a session.
    expect(runInitScript(`${AUTH_HINT_COOKIE}=`)).toBeNull();
    expect(runInitScript(`${AUTH_HINT_COOKIE}=0`)).toBeNull();
    expect(runInitScript(`${AUTH_HINT_COOKIE}=true`)).toBeNull();
  });

  it("falls back to signed out rather than throwing when cookies are unreadable", () => {
    // The script runs before paint and blocks it. An exception escaping here
    // would take the page's first frame with it.
    expect(() =>
      runInitScript(() => {
        throw new Error("cookies blocked");
      })
    ).not.toThrow();
  });
});

describe("signed-in hint / CTA contract", () => {
  it("renders both CTA sets, so neither state needs a server read", () => {
    expect(HEADER).toContain(AUTHED_CLASS);
    expect(HEADER).toContain(ANON_CLASS);
  });

  it("shows the signed-out CTA by default and hides the signed-in one", () => {
    // No attribute means no hint, which is most visitors and every first paint
    // the script could not reach.
    expect(HOME_CSS).toMatch(
      new RegExp(`^\\.${ANON_CLASS}\\s*\\{[^}]*display:\\s*contents`, "m")
    );
    expect(HOME_CSS).toMatch(
      new RegExp(`^\\.${AUTHED_CLASS}\\s*\\{[^}]*display:\\s*none`, "m")
    );
  });

  it("swaps them when the attribute is present", () => {
    expect(HOME_CSS).toMatch(
      new RegExp(`\\[${AUTH_HINT_ATTR}\\]\\s+\\.${ANON_CLASS}\\s*\\{[^}]*display:\\s*none`)
    );
    expect(HOME_CSS).toMatch(
      new RegExp(
        `\\[${AUTH_HINT_ATTR}\\]\\s+\\.${AUTHED_CLASS}\\s*\\{[^}]*display:\\s*contents`
      )
    );
  });

  it("keys the stylesheet on the attribute the script actually sets", () => {
    // Renaming AUTH_HINT_ATTR in TypeScript cannot update a stylesheet, so this
    // is the join between them.
    expect(AUTH_HINT_INIT).toContain(AUTH_HINT_ATTR);
    expect(HOME_CSS).toContain(`[${AUTH_HINT_ATTR}]`);
  });

  it("chooses the scrolled pill's width from the same attribute", () => {
    // The signed-in row is one button shorter. Not cosmetic trivia: the pill
    // animates to a definite max-width, so a missing rule leaves a visible gap
    // where the second button used to be.
    expect(HOME_CSS).toMatch(
      new RegExp(`\\[${AUTH_HINT_ATTR}\\]\\s+nav\\[data-scrolled\\]`)
    );
  });
});

describe("authHintIsCurrent", () => {
  /* The middleware writes the cookie only when this says the two disagree,
     because a Set-Cookie header stops a CDN caching an otherwise-static page,
     the very thing the hint exists to make possible. */
  it("agrees when the cookie matches the validated claims", () => {
    expect(authHintIsCurrent("1", true)).toBe(true);
    expect(authHintIsCurrent(undefined, false)).toBe(true);
  });

  it("disagrees when a session appeared or went away", () => {
    expect(authHintIsCurrent(undefined, true)).toBe(false);
    expect(authHintIsCurrent("1", false)).toBe(false);
  });

  it("treats a cookie the middleware would not have written as stale", () => {
    // An empty string is what a deleted cookie can look like on the way out; it
    // is not absent, so signed-out callers get it cleared properly.
    expect(authHintIsCurrent("", false)).toBe(false);
    expect(authHintIsCurrent("0", true)).toBe(false);
  });
});
