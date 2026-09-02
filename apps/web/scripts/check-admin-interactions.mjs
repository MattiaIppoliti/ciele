import { chromium } from "playwright-core";

// Browser budgets for the interactions a document fetch cannot represent:
// Next.js client navigation and a real Server Action mutation. Manual, not
// part of `pnpm verify`: it needs a browser and a running production build.
// `check:admin-perf` runs it against a local mock-mode build; against staging
// pass the Member's cookie. Credentials stay in environment variables and are
// never printed.
//
// Browser once: pnpm --filter @agent-hub/web exec playwright-core install chromium

const baseUrlValue = process.env.ADMIN_PERF_BASE_URL;
const cookieHeader = process.env.ADMIN_PERF_COOKIE;
const sampleCount = Number(process.env.ADMIN_PERF_SAMPLES ?? 20);

if (!baseUrlValue) throw new Error("ADMIN_PERF_BASE_URL is required");
if (!Number.isSafeInteger(sampleCount) || sampleCount < 5 || sampleCount > 100) {
  throw new Error("ADMIN_PERF_SAMPLES must be an integer from 5 to 100");
}

const baseUrl = new URL(baseUrlValue);
const navigationBudget = { coldMs: 1000, p50Ms: 150, p95Ms: 300 };
const mutationBudget = { p50Ms: 250, p95Ms: 600 };

// Every selector is a `data-testid` the component declares, never a layout
// class or a placeholder string: those change with a redesign and the probe
// would then time out with no hint of what moved.
const READY = {
  assistants: { selector: '[data-testid="assistants-search"]', label: "the Assistants search box" },
  inbox: { selector: '[data-testid="inbox-heading"]', label: "the Inbox heading" },
  improvements: { selector: '[data-testid="improvements-heading"]', label: "the Improvements heading" },
  insights: { selector: '[data-testid="insights-heading"]', label: "the Insights heading" },
};
const PROFILE = {
  firstName: { selector: '[data-testid="profile-first-name"]', label: "the profile first-name field" },
  save: { selector: '[data-testid="profile-save"]', label: "the profile Save button" },
  saved: { selector: '[data-testid="profile-saved"]', label: "the profile Saved marker" },
};

const routes = [
  { path: "/", source: "/inbox", ready: READY.assistants, sourceReady: READY.inbox },
  { path: "/inbox", source: "/", ready: READY.inbox, sourceReady: READY.assistants },
  { path: "/improvements", source: "/", ready: READY.improvements, sourceReady: READY.assistants },
  { path: "/insights", source: "/", ready: READY.insights, sourceReady: READY.assistants },
];

function percentile(values, rank) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil((rank / 100) * ordered.length) - 1)];
}

function cookiesFromHeader(header) {
  return header.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) throw new Error("ADMIN_PERF_COOKIE is not a Cookie header");
    return {
      name: part.slice(0, separator).trim(),
      value: part.slice(separator + 1).trim(),
      url: baseUrl.origin,
    };
  });
}

/** Wait for a named element, failing with the name instead of a raw selector. */
async function expectVisible(page, target, path) {
  try {
    await page.locator(target.selector).first().waitFor({ state: "visible" });
  } catch {
    throw new Error(`${path}: ${target.label} (${target.selector}) never became visible`);
  }
}

async function openAuthenticated(page, path) {
  const response = await page.goto(new URL(path, baseUrl).href, {
    waitUntil: "domcontentloaded",
  });
  if (!response?.ok()) throw new Error(`${path} returned HTTP ${response?.status()}`);
  if (new URL(page.url()).pathname !== path) {
    throw new Error(`${path} redirected to ${new URL(page.url()).pathname}`);
  }
}

async function clickRoute(page, path, ready) {
  const destination = new URL(path, baseUrl);
  const link = page.locator(`a[href="${path}"]:visible`).first();
  try {
    await link.waitFor({ state: "visible" });
  } catch {
    throw new Error(`no visible sidebar link to ${path}`);
  }
  await Promise.all([
    page.waitForURL((url) => url.pathname === destination.pathname),
    expectVisible(page, ready, path),
    link.click(),
  ]);
}

async function navigate(page, route, cold) {
  if (cold) {
    await openAuthenticated(page, route.source);
    await expectVisible(page, route.sourceReady, route.source);
  } else {
    await clickRoute(page, route.source, route.sourceReady);
  }
  const started = performance.now();
  await clickRoute(page, route.path, route.ready);
  return performance.now() - started;
}

async function saveFirstName(page, value, timed) {
  await expectVisible(page, PROFILE.firstName, "/settings/profile");
  const firstName = page.locator(PROFILE.firstName.selector);
  await firstName.fill(value);
  const saved = page.locator(PROFILE.saved.selector);
  await saved.waitFor({ state: "hidden" });
  const save = page.locator(PROFILE.save.selector);
  await expectVisible(page, PROFILE.save, "/settings/profile");
  const actionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().headers()["next-action"] !== undefined,
  );
  await save.evaluate((button, shouldTime) => {
    if (shouldTime) window.__adminPerfStartedAt = performance.now();
    button.click();
  }, timed);
  const response = await actionResponse;
  if (!response.ok()) throw new Error("Profile Server Action failed");
  await expectVisible(page, PROFILE.saved, "/settings/profile");
  await page.waitForFunction(
    ({ expected, inputSelector, buttonSelector }) => {
      const input = document.querySelector(inputSelector);
      const button = document.querySelector(buttonSelector);
      return input?.value === expected && button?.disabled === true;
    },
    {
      expected: value,
      inputSelector: PROFILE.firstName.selector,
      buttonSelector: PROFILE.save.selector,
    },
  );
  return timed
    ? page.evaluate(() => performance.now() - window.__adminPerfStartedAt)
    : null;
}

const browser = await chromium.launch({ headless: true });
let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // A mock-mode build hands out a demo session with no cookie at all.
  if (cookieHeader) await context.addCookies(cookiesFromHeader(cookieHeader));
  const page = await context.newPage();

  for (const route of routes) {
    const cold = await navigate(page, route, true);
    const warm = [];
    for (let index = 0; index < sampleCount; index += 1) {
      warm.push(await navigate(page, route, false));
    }
    const p50 = percentile(warm, 50);
    const p95 = percentile(warm, 95);
    const passes =
      cold <= navigationBudget.coldMs &&
      p50 <= navigationBudget.p50Ms &&
      p95 <= navigationBudget.p95Ms;
    failed ||= !passes;
    console.log(
      `${passes ? "PASS" : "FAIL"} navigate ${route.path} ` +
        `cold=${cold.toFixed(0)}ms/${navigationBudget.coldMs}ms ` +
        `p50=${p50.toFixed(0)}ms/${navigationBudget.p50Ms}ms ` +
        `p95=${p95.toFixed(0)}ms/${navigationBudget.p95Ms}ms (${sampleCount} warm samples)`,
    );
  }

  const mutations = [];
  for (let index = 0; index < sampleCount; index += 1) {
    await openAuthenticated(page, "/settings/profile");
    await expectVisible(page, PROFILE.firstName, "/settings/profile");
    const firstName = page.locator(PROFILE.firstName.selector);
    const originalFirstName = await firstName.inputValue();
    const probeFirstName = originalFirstName
      ? `${originalFirstName.slice(0, -1)}${originalFirstName.endsWith("·") ? "." : "·"}`
      : "·";
    try {
      const elapsed = await saveFirstName(page, probeFirstName, true);
      mutations.push(elapsed);
    } finally {
      // Reload from the database even when a post-response UI assertion
      // failed: a 2xx may already have committed the probe value. Restore only
      // when the persisted value differs, then confirm the restoring action.
      await openAuthenticated(page, "/settings/profile");
      await expectVisible(page, PROFILE.firstName, "/settings/profile");
      const persistedFirstName = await page
        .locator(PROFILE.firstName.selector)
        .inputValue();
      if (persistedFirstName !== originalFirstName) {
        await saveFirstName(page, originalFirstName, false);
      }
    }
  }
  const mutationP50 = percentile(mutations, 50);
  const mutationP95 = percentile(mutations, 95);
  const mutationPasses =
    mutationP50 <= mutationBudget.p50Ms && mutationP95 <= mutationBudget.p95Ms;
  failed ||= !mutationPasses;
  console.log(
    `${mutationPasses ? "PASS" : "FAIL"} profile mutation ` +
      `p50=${mutationP50.toFixed(0)}ms/${mutationBudget.p50Ms}ms ` +
      `p95=${mutationP95.toFixed(0)}ms/${mutationBudget.p95Ms}ms (${sampleCount} samples)`,
  );

  await context.close();
} finally {
  await browser.close();
}

if (failed) process.exitCode = 1;
