import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  colorScheme: "dark",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://localhost:3000/library/websites");
  await page.waitForTimeout(1200); // Let streamed shell hydration finish before navigating.
  await page.evaluate(() => {
    window.tabTransitions = [];
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      window.tabTransitions.push(
        document.documentElement.style.getPropertyValue("--tab-enter-x"),
      );
      return start(update);
    };
  });
  await page.getByRole("link", { name: /Files/ }).click();
  await page.waitForURL("**/library/files");
  await page.waitForTimeout(400);
  await page.getByRole("link", { name: /Websites/ }).click();
  await page.waitForURL("**/library/websites");
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(() => window.tabTransitions), [
    "100%",
    "-100%",
  ]);
  assert.equal(await page.locator("[data-route-sliding-panel]").count(), 1);
  await page.goto("http://localhost:3000/alerts");
  await page.getByRole("button", { name: /Needs attention/ }).click();
  await page.waitForTimeout(300);
  assert.equal(
    await page
      .locator('[data-slot="sliding-panel-content"]:not([inert])')
      .count(),
    1,
  );
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.goto("http://localhost:3000/assistants/Vrp47KxooVPk/flows/new");
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  const byHand = page.getByRole("button", { name: "build it by hand", exact: true });
  if (await byHand.isVisible()) await byHand.click();
  const toolbar = page.getByRole("toolbar", {
    name: "Canvas tools",
    exact: true,
  });
  await toolbar
    .getByRole("button", { name: "Add a step", exact: true })
    .click();
  await page
    .locator(".bar-flyout")
    .getByRole("button", { name: /^Message/ })
    .click();
  const message = page.getByRole("textbox", { name: "Message", exact: true });
  await message.fill("Keep this draft across tabs");
  await message.evaluate((e) => {
    window.originalMessage = e;
  });
  const configure = page.getByRole("tab", { name: "Configure", exact: true });
  const run = page.getByRole("tab", { name: "Run node", exact: true });
  await run.click();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole("tabpanel").count(), 1);
  await configure.click();
  await page.waitForTimeout(300);
  assert.equal(await message.inputValue(), "Keep this draft across tabs");
  assert.equal(
    await message.evaluate((e) => e === window.originalMessage),
    true,
    "form remains mounted",
  );
  for (let i = 0; i < 3; i++) {
    await run.click();
    await configure.click();
  }
  await page.waitForTimeout(350);
  assert.equal(await page.getByRole("tabpanel").count(), 1);
  assert.equal(await message.inputValue(), "Keep this draft across tabs");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await run.click();
  await page.waitForTimeout(30);
  const transform = await page
    .getByRole("tabpanel")
    .locator('[data-slot="sliding-tab-content"]')
    .evaluate((e) => getComputedStyle(e).transform);
  assert.ok(
    transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)",
    "reduced motion fades without travel",
  );
  await configure.click();
  await page.waitForTimeout(200);
  assert.equal(await message.inputValue(), "Keep this draft across tabs");
  assert.deepEqual(errors, []);
  console.log(
    "PASS route directions, Alerts switching, mounted form identity, draft retention, rapid reversals, inactive accessibility, reduced-motion fade",
  );
} finally {
  await browser.close();
}
