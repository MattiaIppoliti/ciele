import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  colorScheme: "dark",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const toolbar = page.getByRole("toolbar", {
  name: "Canvas tools",
  exact: true,
});
const canvas = page.locator(".flow-canvas");
const camera = page.locator(".react-flow__viewport");
const transform = () => camera.getAttribute("style");
try {
  await page.goto(
    new URL(
      "/assistants/Vrp47KxooVPk/flows/new",
      process.env.TABLE_LAYOUT_BASE_URL ?? "http://localhost:3000",
    ).href,
  );
  await page.getByRole("button", { name: "Canvas", exact: true }).click();
  await toolbar.waitFor();
  const byHand = page.getByRole("button", { name: "build it by hand", exact: true });
  if (await byHand.isVisible()) await byHand.click();
  await page.getByRole("heading", { name: "Preview", exact: true }).hover();
  await page.getByRole("button", { name: "Hide preview", exact: true }).click();
  await page.locator(".command-bar").waitFor();
  const select = toolbar.getByRole("button", { name: "Select", exact: true });
  const pan = toolbar.getByRole("button", { name: "Pan", exact: true });
  await pan.click();
  assert.equal(await pan.getAttribute("aria-pressed"), "true");
  const oldCamera = await transform();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width - 100, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 160, box.y + 120, { steps: 10 });
  await page.mouse.up();
  assert.notEqual(
    await transform(),
    oldCamera,
    "Pan changes the real canvas camera",
  );
  await select.click();
  assert.equal(await select.getAttribute("aria-pressed"), "true");
  assert.equal(await pan.getAttribute("aria-pressed"), "false");
  const add = toolbar.getByRole("button", { name: "Add a step", exact: true });
  await add.click();
  assert.equal(await add.getAttribute("aria-expanded"), "true");
  await page.locator(".canvas-toolbar .bar-flyout").waitFor();
  await page.keyboard.press("Escape");
  await page
    .locator(".canvas-toolbar .bar-flyout")
    .waitFor({ state: "hidden" });
  assert.equal(await add.evaluate((e) => e === document.activeElement), true);
  await add.click();
  const beforeNodes = await page.locator(".react-flow__node").count();
  await page
    .locator(".canvas-toolbar .bar-flyout")
    .getByRole("button", { name: /^Message/ })
    .click();
  await page.waitForFunction(
    (count) => document.querySelectorAll(".react-flow__node").length > count,
    beforeNodes,
  );
  assert.equal(await add.getAttribute("aria-expanded"), "false");
  const more = toolbar.getByRole("button", {
    name: "More canvas controls",
    exact: true,
  });
  const beforeZoom = await transform();
  await toolbar.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.waitForFunction(
    (previous) =>
      document.querySelector(".react-flow__viewport").getAttribute("style") !==
      previous,
    beforeZoom,
  );
  await more.click();
  const direction = page.getByRole("menuitem", {
    name: /^Switch to .* layout$/,
  });
  assert.equal(await page.getByRole("menuitem").count(), 2);
  const directionLabel = await direction.getAttribute("aria-label");
  await direction.click();
  await more.click();
  await page
    .getByRole("menuitem", {
      name: directionLabel.includes("horizontal")
        ? "Switch to vertical layout"
        : "Switch to horizontal layout",
      exact: true,
    })
    .waitFor();
  await page.keyboard.press("Escape");
  // Drag from the core toward the orientation spoke; release commits its real action.
  await more.click();
  await page.waitForTimeout(450);
  await page.screenshot({ path: "/tmp/pr1021-canvas-radial.png" });
  const spoke = page.getByRole("menuitem", { name: /^Switch to .* layout$/ });
  const spokeLabel = await spoke.getAttribute("aria-label");
  const spokeBox = await spoke.boundingBox();
  await more.click();
  const coreBox = await more.boundingBox();
  await page.mouse.move(
    coreBox.x + coreBox.width / 2,
    coreBox.y + coreBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    spokeBox.x + spokeBox.width / 2,
    spokeBox.y + spokeBox.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  assert.equal(await more.getAttribute("aria-expanded"), "false");
  await more.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: /Tidy up/ }).waitFor();
  assert.equal(
    await page
      .getByRole("menuitem", { name: /Tidy up/ })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("ArrowRight");
  const opposite = page.getByRole("menuitem", {
    name: spokeLabel.includes("horizontal")
      ? "Switch to vertical layout"
      : "Switch to horizontal layout",
    exact: true,
  });
  assert.equal(
    await opposite.evaluate((e) => e === document.activeElement),
    true,
  );
  await page.keyboard.press("Escape");
  assert.equal(await more.evaluate((e) => e === document.activeElement), true);
  const cameraBeforeCancel = await transform();
  await more.dispatchEvent("pointercancel");
  assert.equal(
    await transform(),
    cameraBeforeCancel,
    "cancellation never runs an action",
  );
  await toolbar
    .getByRole("button", { name: "Fit to view", exact: true })
    .click();
  await page.screenshot({ path: "/tmp/pr1021-canvas-toolbar-selected.png" });
  await page
    .getByRole("button", { name: "Close node panel", exact: true })
    .click();
  const prompt = page.getByRole("textbox", {
    name: "Ask the Flows Agent",
    exact: true,
  });
  await prompt.fill("Draft a response");
  await prompt.fill(""); // No agent request or server save during this check.
  for (const width of [1600, 1100, 800]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(350);
    const c = await canvas.boundingBox();
    const t = await toolbar.boundingBox();
    const a = await page.locator(".command-bar").boundingBox();
    assert.ok(t.height > t.width * 4, "toolbar is vertical");
    await more.click();
    for (const option of await page.getByRole("menuitem").all()) {
      const o = await option.boundingBox();
      assert.ok(
        o.x >= c.x &&
          o.x + o.width <= c.x + c.width &&
          o.y >= c.y &&
          o.y + o.height <= c.y + c.height,
        "fan options fit canvas",
      );
    }
    await page.keyboard.press("Escape");
    assert.ok(
      Math.abs(a.x + a.width / 2 - c.x - c.width / 2) < 2,
      "agent is centered on the canvas",
    );
    assert.ok(
      t.x >= c.x && t.x + t.width <= c.x + c.width + 1,
      "toolbar stays at the left inside the canvas",
    );
    assert.ok(
      t.x + t.width <= a.x || t.y + t.height <= a.y,
      "toolbar and prompt do not overlap",
    );
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await select.click();
  assert.equal(
    await select.evaluate(
      (e) => getComputedStyle(e, "::before").transitionDuration,
    ),
    "0s",
  );
  await page.screenshot({ path: "/tmp/pr1021-canvas-toolbar-wide.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS select, pointer pan, step picker, Escape focus, add step, zoom, direction, fit, centered agent, responsive layout and reduced motion",
  );
} finally {
  await browser.close();
}
