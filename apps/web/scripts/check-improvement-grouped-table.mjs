import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1500, height: 1000 },
  colorScheme: "dark",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const row = page
  .locator('[data-slot="improvement-grouped-row"]:visible')
  .first();
const panel = page.locator('[data-slot="improvement-grouped-table"]:visible');
const grip = page.getByRole("separator", {
  name: "Resize improvements width",
  exact: true,
});
// Position springs use rAF rather than CSS animations. Compare successive
// frames until the real fields have remained still for twelve frames.
async function settle() {
  await page.evaluate(async () => {
    let previous = "",
      stable = 0;
    for (let frame = 0; frame < 180 && stable < 12; frame++) {
      await new Promise(requestAnimationFrame);
      const row = [
        ...document.querySelectorAll('[data-slot="improvement-grouped-row"]'),
      ].find((e) => e.getBoundingClientRect().height);
      if (!row) return;
      const current = [
        ...row.querySelectorAll("[data-field]"),
        ...document.querySelectorAll(
          '[data-slot="improvement-task-panel"], [data-slot="improvement-list-pane"]',
        ),
      ]
        .flatMap((e) => {
          const b = e.getBoundingClientRect();
          return [b.x, b.y, b.width].map((n) => Math.round(n * 10));
        })
        .join(",");
      stable = current === previous ? stable + 1 : 0;
      previous = current;
    }
    if (stable < 12) throw new Error("Row spring did not settle");
  });
}
async function resize(width) {
  const before = await panel.evaluate((e) => e.getBoundingClientRect().width);
  const b = await grip.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 100);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + width - before, b.y + 100, {
    steps: 12,
  });
  await page.mouse.up();
  await settle();
  assert.ok(
    Math.abs(
      (await panel.evaluate((e) => e.getBoundingClientRect().width)) - width,
    ) < 2,
  );
}
try {
  await page.goto(
    new URL(
      "/improvements",
      process.env.TABLE_LAYOUT_BASE_URL ?? "http://localhost:3000",
    ).href,
  );
  await row.waitFor();
  await grip.waitFor();
  await settle();
  const count = await page
    .locator('[data-slot="improvement-grouped-row"]:visible')
    .count();
  const link = await row.locator("xpath=..").getAttribute("href");
  let wideKey;
  for (const width of [1024, 800, 650, 550, 450, 350, 650, 800, 1024]) {
    await resize(width);
    const expected =
      width >= 896 ? "expanded" : width >= 768 ? "columns" : "inline";
    assert.equal(await row.getAttribute("data-layout"), expected);
    assert.equal(
      await page
        .locator('[data-slot="improvement-grouped-row"]:visible')
        .count(),
      count,
    );
    assert.equal(await row.locator("xpath=..").getAttribute("href"), link);
    const fields = await row.locator("[data-field]").evaluateAll((elements) =>
      Object.fromEntries(
        elements.map((e) => {
          const b = e.getBoundingClientRect();
          return [e.dataset.field, { x: b.x, y: b.y, h: b.height }];
        }),
      ),
    );
    for (const key of ["title", "key", "activity", "date", "assignee"])
      assert.ok(fields[key].h > 0);
    assert.ok(Math.abs(fields.title.y - fields.date.y) < 2);
    if (width === 1024) wideKey = fields.key.x - fields.title.x;
    if (width === 650)
      assert.ok(
        fields.key.x - fields.title.x < wideKey - 100,
        "key joins the title",
      );
    if (width === 350) {
      await row.locator('[data-field="assignee"]').scrollIntoViewIfNeeded();
      const reachable = await row
        .locator('[data-field="assignee"]')
        .evaluate((e) => {
          const a = e.getBoundingClientRect(),
            b = e
              .closest('[data-slot="improvement-grouped-scroll"]')
              .getBoundingClientRect();
          return a.left >= b.left - 1 && a.right <= b.right + 1;
        });
      assert.ok(reachable, "overflow fields stay reachable");
      await page
        .locator('[data-slot="improvement-grouped-scroll"]:visible')
        .evaluate((e) => {
          e.scrollLeft = 0;
        });
    }
    console.log(`PASS ${width}px: ${expected}, retained row and metadata`);
  }
  await grip.press("Home");
  const springFrames = await row
    .locator('[data-field="key"]')
    .evaluate(async (element) => {
      const frames = [];
      for (let i = 0; i < 50; i++) {
        await new Promise(requestAnimationFrame);
        const box = element.getBoundingClientRect();
        frames.push({
          x: box.x,
          transform: getComputedStyle(element).transform,
        });
      }
      return frames;
    });
  assert.ok(
    springFrames.some((frame) => frame.transform !== "none"),
    "resize projects the same field through a spring",
  );
  assert.ok(
    new Set(springFrames.map((frame) => Math.round(frame.x))).size > 5,
    "resize includes intermediate positions",
  );
  console.log(
    "PASS resize spring: intermediate positions on the existing key element",
  );
  await settle();
  assert.equal(Number(await grip.getAttribute("aria-valuenow")), 320);
  await grip.press("End");
  await settle();
  const height = page.getByRole("separator", {
    name: "Resize improvements height",
    exact: true,
  });
  const oldHeight = Number(await height.getAttribute("aria-valuenow"));
  await height.press("ArrowUp");
  assert.equal(
    Number(await height.getAttribute("aria-valuenow")),
    oldHeight - 10,
  );
  await height.press("End");
  const lane = page.locator('[data-improvement-lane="to_do"]:visible');
  await lane.getByRole("button", { expanded: true }).first().click();
  await page.waitForFunction(
    () =>
      document.querySelector("#improvements-lane-to_do").getBoundingClientRect()
        .height < 1,
  );
  assert.equal(
    await page
      .locator("#improvements-lane-to_do")
      .first()
      .getAttribute("inert"),
    "",
  );
  await lane.getByRole("button", { expanded: false }).first().click();
  await row.waitFor();
  await settle();
  const listPane = page.locator('[data-slot="improvement-list-pane"]');
  const taskPane = page.locator('[data-slot="improvement-task-panel"]:visible');
  const originalWidth = (await listPane.boundingBox()).width;
  const openedTitle = await row.locator('[data-field="title"]').innerText();
  await row.locator("xpath=..").click();
  const closeTask = page.getByRole("button", {
    name: "Close Improvement panel",
    exact: true,
  });
  await closeTask.waitFor();
  await settle();
  assert.ok(new URL(page.url()).searchParams.get("open"));
  const listBox = await listPane.boundingBox();
  const taskBox = await taskPane.boundingBox();
  assert.ok(
    listBox.width < originalWidth - 300,
    "opening task shrinks the list",
  );
  assert.ok(
    listBox.x + listBox.width <= taskBox.x,
    "task does not cover the list",
  );
  const material = await taskPane
    .locator('[data-slot="improvement-task-card"]')
    .evaluate((e) => ({
      radius: parseFloat(getComputedStyle(e).borderTopLeftRadius),
      color: getComputedStyle(e).backgroundColor,
    }));
  assert.ok(material.radius >= 12);
  assert.equal(
    material.color,
    await panel.evaluate((e) => getComputedStyle(e).backgroundColor),
  );
  assert.equal(await taskPane.getAttribute("aria-modal"), null);
  const splitGrip = page.getByRole("separator", {
    name: "Resize improvement panel",
    exact: true,
  });
  const splitBefore = await taskPane.boundingBox();
  const handleBox = await splitGrip.boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 80,
    handleBox.y + 100,
    { steps: 12 },
  );
  await page.mouse.up();
  await settle();
  assert.ok((await taskPane.boundingBox()).width < splitBefore.width - 70);
  assert.ok((await listPane.boundingBox()).width > listBox.width + 70);
  await page.screenshot({ path: "/tmp/pr1021-improvements-task-split.png" });
  const titleField = taskPane.getByRole("heading", {
    name: openedTitle,
    exact: true,
  });
  await titleField.waitFor();
  const titleNode = await titleField.elementHandle();
  await page
    .getByRole("button", { name: "Open full screen", exact: true })
    .click();
  await settle();
  assert.ok((await listPane.boundingBox()).width < 2);
  assert.equal(await taskPane.getAttribute("aria-modal"), "true");
  assert.ok(Math.abs((await taskPane.boundingBox()).width - originalWidth) < 2);
  await page.screenshot({
    path: "/tmp/pr1021-improvements-task-fullscreen.png",
  });
  await page
    .getByRole("button", { name: "Exit full screen", exact: true })
    .click();
  await settle();
  assert.ok((await listPane.boundingBox()).width > listBox.width + 70);
  assert.ok(
    await titleNode.evaluate((e) => e.isConnected),
    "full screen preserves the loaded editor",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  assert.equal(await taskPane.getAttribute("aria-modal"), "true");
  assert.ok((await listPane.boundingBox()).width < 2);
  assert.ok((await taskPane.boundingBox()).width <= 390);
  await page.screenshot({ path: "/tmp/pr1021-improvements-task-mobile.png" });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await settle();
  assert.equal(await taskPane.getAttribute("aria-modal"), null);
  await closeTask.click();
  await page.waitForURL((url) => !url.searchParams.has("open"));
  await settle();
  assert.ok(Math.abs((await listPane.boundingBox()).width - originalWidth) < 2);
  console.log(
    "PASS rounded matching material, split resize, full screen and restoring list",
  );
  await page.getByRole("button", { name: "Kanban view", exact: true }).click();
  await panel.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "List view", exact: true }).click();
  await row.waitFor();
  await page
    .getByPlaceholder("Search improvements…")
    .fill("No such improvement xyz");
  await row.waitFor({ state: "hidden" });
  await page.getByPlaceholder("Search improvements…").fill("");
  await row.waitFor();
  await settle();
  await page.screenshot({ path: "/tmp/pr1021-improvements-grouped-wide.png" });
  await resize(650);
  await page.screenshot({
    path: "/tmp/pr1021-improvements-grouped-narrow.png",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await resize(1024);
  const transform = await row
    .locator('[data-field="key"]')
    .evaluate((e) => getComputedStyle(e).transform);
  assert.ok(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)");
  assert.deepEqual(errors, []);
  console.log(
    "PASS keyboard sizing, collapse, drawer, Kanban, search and reduced motion",
  );
} finally {
  await browser.close();
}
