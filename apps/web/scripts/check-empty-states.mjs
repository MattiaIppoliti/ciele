import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.EMPTY_STATE_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  colorScheme: "dark",
});
page.setDefaultTimeout(120000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function open(path) {
  await page.goto(new URL(path, base).href, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForSelector("html[data-squircle-ready]");
}
async function checkState(title) {
  const state = page
    .locator('[data-slot="empty-state"]:visible')
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .first();
  await state.waitFor();
  assert.equal(await state.getAttribute("aria-label"), title);
  assert.equal(await state.locator("h3").count(), 1);
  assert.equal(await state.locator('[aria-hidden="true"] svg').count(), 1);
  assert.ok((await state.locator("p").innerText()).trim().length > 0);
  const styles = await state
    .locator("div")
    .first()
    .evaluate((element) => ({
      radius: parseFloat(getComputedStyle(element).borderRadius),
      filter: getComputedStyle(element).filter,
    }));
  assert.ok(styles.radius > 0);
  assert.equal(styles.filter, "none");
  return state;
}
try {
  await open("/");
  await page
    .locator('[data-testid="assistants-search"]:visible')
    .first()
    .fill("no-assistant-matches-xyz");
  await checkState("No matching assistants");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page
    .getByRole("heading", { name: "No matching assistants", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(
    await page
      .locator('[data-testid="assistants-search"]:visible')
      .first()
      .inputValue(),
    "",
  );
  console.log("PASS assistant search recovery");

  await open("/inbox?q=no-conversation-matches-xyz");
  await checkState("No conversations");
  await checkState("Select a conversation");
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  assert.equal(
    await page.getByPlaceholder("Search conversations").inputValue(),
    "",
  );
  console.log(
    "PASS empty conversation list, selection guidance and reset search/filters",
  );

  await open("/library/files");
  await page
    .getByRole("searchbox", { name: "Search files", exact: true })
    .fill("no-files-match-xyz");
  const empty = await checkState("No matching sources");
  await page.screenshot({ path: "/tmp/pr1021-empty-table-dark.png" });
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const table = await empty.evaluate((element) => {
      const a = element.getBoundingClientRect();
      const view = element
        .closest('[data-slot="table-container"]')
        .getBoundingClientRect();
      return {
        left: a.left,
        right: a.right,
        viewLeft: view.left,
        viewRight: view.right,
      };
    });
    assert.ok(
      table.left >= table.viewLeft - 1 && table.right <= table.viewRight + 1,
      `empty state fits at ${width}px`,
    );
  }
  await page.screenshot({ path: "/tmp/pr1021-empty-mobile.png" });
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  });
  await page.waitForTimeout(350);
  await empty.screenshot({ path: "/tmp/pr1021-empty-table-light.png" });
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByRole("heading", { name: "No matching sources", exact: true }).waitFor({ state: "hidden" });
  await page.locator('[data-slot="table-header"]:visible').waitFor();
  console.log("PASS native table bounds at 1440/800/390px, light/dark appearance and filter recovery");

  if (process.env.EMPTY_STATE_FIXTURE_PATH) {
    await page.setViewportSize({ width: 1000, height: 1000 });
    await open(process.env.EMPTY_STATE_FIXTURE_PATH);
    const state = page.getByRole("region", {
      name: "State preview",
      exact: true,
    });
    await state.waitFor();
    await page.waitForTimeout(600);
    const identity = await state.elementHandle();
    await page.evaluate(() => document.fonts.ready);
    const short = (await state.boundingBox()).height;
    const originalIcon = await state
      .locator('[aria-hidden="true"] svg')
      .elementHandle();
    await page.getByRole("button", { name: "Rerender", exact: true }).click();
    assert.ok(
      await originalIcon.evaluate((element) => element.isConnected),
      "same icon stays mounted on ordinary rerenders",
    );
    await page.getByRole("button", { name: "Long state", exact: true }).click();
    const frames = await state.evaluate(async (element) => {
      const frames = [];
      for (let frame = 0; frame < 55; frame++) {
        await new Promise(requestAnimationFrame);
        frames.push({
          height: element.getBoundingClientRect().height,
          hiddenCopy: !!element.querySelector('h3 [aria-hidden="true"]'),
          frameHeight: element.children[1].style.height,
        });
      }
      return frames;
    });
    assert.ok(
      frames.some((frame) => frame.hiddenCopy),
      "outgoing copy is hidden from assistive tech",
    );
    assert.ok(
      new Set(frames.map((frame) => Math.round(frame.height))).size > 4,
      "height includes intermediate spring positions",
    );
    assert.ok((await state.boundingBox()).height > short + 20);
    assert.equal(
      await state
        .locator("div")
        .nth(2)
        .evaluate((element) => getComputedStyle(element).overflow),
      "visible",
    );
    assert.ok(
      await identity.evaluate((element) => element.isConnected),
      "state stays mounted",
    );
    await page
      .getByRole("button", { name: "Short state", exact: true })
      .click();
    await page.getByRole("button", { name: "Long state", exact: true }).click();
    await page.waitForTimeout(700);
    assert.equal(await state.locator("h3").innerText(), "Ready to keep going");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Short state", exact: true })
      .click();
    await page.waitForTimeout(180);
    assert.ok(Math.abs((await state.boundingBox()).height - short) < 1);
    assert.equal(
      await state
        .locator("div")
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
      "none",
    );
    const transforms = await state
      .locator("h3 span, p span")
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).transform),
      );
    assert.ok(
      transforms.every(
        (value) => value === "none" || value === "matrix(1, 0, 0, 1, 0, 0)",
      ),
    );
    console.log(
      "PASS retained state, animated height, hidden exiting copy, rapid reversal and live reduced motion",
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
