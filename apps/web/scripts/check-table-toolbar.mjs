import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const base = process.env.TABLE_LAYOUT_BASE_URL ?? "http://localhost:3145";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1400 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const card = () => page.locator('[data-slot="table-card"]:not([aria-hidden="true"] *)').filter({ visible: true }).first();
async function expectCount(total, noun) {
  await page.waitForFunction(({ total, noun }) => [...document.querySelectorAll('[data-slot="table-results"] scritto-text')]
    .some((text) => text.getAttribute("aria-label") === `${total} ${noun}`), { total, noun });
}
async function ready(route) {
  await page.goto(new URL(route, base).href);
  await card().waitFor();
  await card().scrollIntoViewIfNeeded();
  await page.waitForFunction(table => table?.style.getPropertyValue("--table-width"), await card().locator("table").elementHandle());
}
async function select(label, option) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function expectOptionsReachable() {
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  assert.ok(await page.getByRole("option").evaluateAll(options => options.every(option => {
    const box = option.getBoundingClientRect();
    return option.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })), "open options are visible and not clipped by the table frame");
}
try {
  await ready("/settings/members");
  await expectCount(6, "members");
  assert.ok(await card().locator("tbody tr").evaluateAll((rows) => rows.every((row) =>
    row.querySelector("td p scritto-text")?.getBoundingClientRect().width > 0)), "member names remain visible beside their avatars");
  assert.ok(await card().getByText("Total Results", { exact: true }).isVisible());
  assert.ok(await card().getByRole("button", { name: "Previous page", exact: true }).isDisabled());
  assert.ok(await card().getByRole("button", { name: "Next page", exact: true }).isDisabled());
  assert.equal(await card().getByRole("button", { name: "Page 1", exact: true }).getAttribute("aria-current"), "page");
  await card().getByRole("button", { name: "Rows per page", exact: true }).click();
  await expectOptionsReachable();
  await page.keyboard.press("Escape");
  await select("Filter by role", "Editor"); await expectCount(3, "members");
  assert.equal(await page.getByRole("button", { name: "Filter by role", exact: true }).getAttribute("data-table-filter-active"), "true");
  assert.equal(await card().locator("tbody tr").count(), 3);
  await page.getByRole("button", { name: "Undo table change", exact: true }).click(); await expectCount(6, "members");
  await page.getByRole("button", { name: "Redo table change", exact: true }).click(); await expectCount(3, "members");
  await select("Filter by role", "All roles"); await expectCount(6, "members");
  await select("Filter by status", "Pending"); await expectCount(0, "members");
  await select("Filter by status", "All statuses"); await expectCount(6, "members");
  await page.getByRole("searchbox", { name: "Search members", exact: true }).fill("no-such-person-789"); await expectCount(0, "members");
  await page.getByRole("button", { name: "Clear search members", exact: true }).click(); await expectCount(6, "members");
  assert.ok(await page.getByRole("searchbox", { name: "Search members", exact: true }).evaluate(input => input === document.activeElement));
  assert.equal((await card().innerText()).includes("Showing"), false);
  console.log("PASS Members: real totals, role/status/search filters, empty results and filter Undo/Redo");

  // This is the in-memory demo, never a live organization. Extra invitations
  // exercise two actual client pages and are revoked after the check.
  assert.ok(await page.getByText("Demo mode, members are not persisted", { exact: true }).isVisible());
  const invites = [];
  try {
    for (let index = 0; index < 5; index++) {
      const email = `table-pagination-check-${index}@example.invalid`; invites.push(email);
      await page.getByRole("textbox", { name: "Invite email (optional)", exact: true }).fill(email);
      await page.getByRole("button", { name: "Create invite", exact: true }).click();
      await expectCount(7 + index, "members");
    }
    await select("Rows per page", "10");
    assert.equal(await card().locator("tbody tr").count(), 10);
    const firstIds = await card().locator("tbody tr").evaluateAll((rows) => rows.map((row) => row.dataset.tableRowId));
    await card().getByRole("button", { name: "Next page", exact: true }).click();
    assert.equal(await card().getByRole("button", { name: "Page 2", exact: true }).getAttribute("aria-current"), "page");
    assert.equal(await card().locator("tbody tr").count(), 1);
    assert.ok(!firstIds.includes(await card().locator("tbody tr").getAttribute("data-table-row-id")));
    assert.ok(await card().getByRole("button", { name: "Next page", exact: true }).isDisabled());
    await card().getByRole("button", { name: "Page 1", exact: true }).click();
    await card().getByRole("button", { name: "Page 2", exact: true }).click();
    await select("Filter by role", "Viewer"); await expectCount(1, "member");
    assert.equal(await card().getByRole("button", { name: "Page 1", exact: true }).getAttribute("aria-current"), "page");
    assert.equal(await card().getByRole("button", { name: "Page 2", exact: true }).count(), 0);
    await select("Filter by role", "All roles"); await expectCount(11, "members");
    await select("Rows per page", "25");
    console.log("PASS client pagination: page size, Next, numbered pages, short last page and filter reset");
  } finally {
    await page.getByRole("searchbox", { name: "Search members", exact: true }).fill("");
    await select("Filter by role", "All roles");
    await select("Rows per page", "25");
    let remaining = 6 + invites.length;
    for (const email of invites) {
      await ready("/settings/members");
      const action = page.getByRole("button", { name: `Revoke invitation for ${email}`, exact: true });
      await action.waitFor();
      await action.click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("slider", { name: "Slide to revoke", exact: true }).press("End");
      await expectCount(--remaining, remaining === 1 ? "member" : "members");
      await action.waitFor({ state: "detached" });
    }
  }
  await expectCount(6, "members");

  await ready("/library/websites");
  await expectCount(1, "website");
  await select("Filter by status", "Error");
  await page.waitForURL((url) => url.searchParams.get("status") === "error"); await expectCount(0, "websites");
  await select("Filter by status", "All statuses"); await expectCount(1, "website");
  await page.getByRole("searchbox", { name: "Search websites", exact: true }).fill("no-such-site-789");
  await page.waitForURL((url) => url.searchParams.get("q") === "no-such-site-789"); await expectCount(0, "websites");
  await page.getByRole("searchbox", { name: "Search websites", exact: true }).fill(""); await expectCount(1, "website");
  await select("Filter by assistant", "Alex");
  await page.waitForURL((url) => Boolean(url.searchParams.get("assistant"))); await expectCount(1, "website");
  console.log("PASS Library: toolbar drives existing server status, assistant and debounced search queries");

  await ready("/alerts"); await expectCount(2, "alerts");
  await select("Filter by status", "Resolved"); await expectCount(1, "alert");
  await select("Filter by status", "All statuses"); await expectCount(2, "alerts");
  await select("Filter by category", "Crawl"); await expectCount(1, "alert");
  assert.equal(await card().locator("tbody tr").count(), 1);
  await select("Filter by category", "All categories"); await expectCount(2, "alerts");
  console.log("PASS Alerts: status/category filters and singular/plural result counts");

  await ready("/settings/members");
  const actionsHeading = card().getByRole("columnheader", { name: "Actions", exact: true });
  await actionsHeading.scrollIntoViewIfNeeded();
  assert.ok(await actionsHeading.isVisible());
  assert.equal(await actionsHeading.evaluate(header => [...header.querySelectorAll(".truncate")]
    .some(label => label.scrollWidth > label.clientWidth + 1)), false, "Actions heading is fully readable");
  await ready("/library/websites/src-alex-website");
  await expectCount(7, "documents");
  await card().getByRole("columnheader", { name: "Actions", exact: true }).scrollIntoViewIfNeeded();
  const firstDocument = card().locator("tbody tr").first();
  assert.equal(await firstDocument.locator("td:last-child a").count(), 1);
  assert.equal(await firstDocument.locator("td:last-child button").count(), 2);
  assert.ok(await firstDocument.getByRole("button", { name: /^Copy ID for / }).isVisible());
  console.log("PASS Members and site documents: visible fixed Actions header and document Open/Copy/exclusion controls");

  await ready("/settings/usage");
  await expectCount(3, "usage entries");
  await select("Filter by kind", "Crawl"); await expectCount(1, "usage entry");
  await select("Filter by kind", "All kinds"); await expectCount(3, "usage entries");
  await card().getByRole("searchbox", { name: "Search usage entries", exact: true }).fill("no-such-model-789");
  await expectCount(0, "usage entries");
  await card().getByRole("searchbox", { name: "Search usage entries", exact: true }).fill(""); await expectCount(3, "usage entries");
  await ready("/insights/costs");
  await expectCount(5, "models");
  await card().getByRole("searchbox", { name: "Search models", exact: true }).fill("no-such-model-789");
  await expectCount(0, "models");
  await card().getByRole("searchbox", { name: "Search models", exact: true }).fill(""); await expectCount(5, "models");
  await ready("/eval");
  await select("Filter by stage", "Classifier");
  await page.waitForURL(url => url.searchParams.get("stage") === "classifier");
  await expectCount(0, "runs");
  await select("Rows per page", "10");
  await page.waitForURL(url => url.searchParams.get("size") === "10");
  assert.equal(new URL(page.url()).searchParams.get("stage"), "classifier");
  await select("Filter by stage", "All stages");
  await page.waitForURL(url => !url.searchParams.has("stage"));
  assert.equal(new URL(page.url()).searchParams.get("size"), "10");
  console.log("PASS Settings Usage, Insights Costs and Eval: filters, totals and URL page-size state");

  for (const route of ["/settings/members", "/settings/api-keys", "/library/websites", "/alerts", "/settings/usage", "/insights/costs", "/eval", "/library/websites/src-alex-website"]) {
    await ready(route);
    for (const width of [390, 760, 980, 1500]) {
      await page.setViewportSize({ width, height: 1400 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${route} at ${width}px`);
      assert.ok(await card().getByRole("button", { name: "Next page", exact: true }).isVisible());
      assert.ok(await card().locator('[data-slot="table-filters"]').isVisible());
    }
  }
  await ready("/settings/members");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
  await card().screenshot({ path: "/tmp/ciele-tables-toolbar-members.png" });
  assert.deepEqual(errors, []);
  console.log("PASS toolbar and page controls: mobile, tablet and desktop without page overflow or runtime errors");
} finally { await browser.close(); }
