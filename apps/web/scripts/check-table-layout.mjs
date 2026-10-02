import assert from "node:assert/strict";
import { chromium } from "playwright-core";

// Run against the local demo: node apps/web/scripts/check-table-layout.mjs
// Check the visible table and real pointer resizing, including narrow panels.
const base = process.env.TABLE_LAYOUT_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const settle = async () => {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.target?.closest("main") && animation.effect.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))));
};
try {
  for (const route of ["/alerts", "/library/websites"]) {
    await page.goto(new URL(route, base).href);
    await page.waitForFunction(() => document.querySelector("table tbody tr"));
    const handle = page.getByRole("separator", { name: route === "/alerts" ? "Resize the issue column" : "Resize the name column", exact: true });
    await handle.waitFor({ state: "visible", timeout: 5000 });
    const logicalColumns = await page.locator("table th").count();
    for (const viewport of [1500, 1420, 1280, 1200, 1112, 980, 1280, 1500]) {
      await page.setViewportSize({ width: viewport, height: 900 });
      await settle();
      const defects = await page.evaluate((logicalColumns) => {
        const defects = [];
        const table = document.querySelector("table");
        const rows = [...table.querySelectorAll("thead tr, tbody tr")].filter(row => [...row.cells].every(cell => cell.colSpan === 1));
        const header = rows[0];
        for (const grip of table.querySelectorAll('[data-slot="column-resize-handle"]')) {
          if (Number(grip.getAttribute("aria-valuemin")) !== 120) defects.push("data column minimum differs from 120px");
          if (!grip.getBoundingClientRect().width) defects.push(`hidden resize handle: ${grip.getAttribute("aria-label")}`);
        }
        for (const row of rows) {
          if (row.cells.length !== logicalColumns) defects.push("missing column");
          const boxes = [...row.cells].map(cell => cell.getBoundingClientRect());
          boxes.forEach((box, column) => {
            if (Math.abs(box.top - boxes[0].top) > 1 || Math.abs(box.bottom - boxes[0].bottom) > 1) defects.push("columns split across two lines in one row");
            if (column && Math.abs(box.left - boxes[column - 1].right) > 1) defects.push(`gap before column ${column}`);
            if (Math.abs(box.left - header.cells[column].getBoundingClientRect().left) > 1) defects.push(`misaligned column ${column}`);
            if (column < boxes.length - 1 && parseFloat(getComputedStyle(row.cells[column]).borderRightWidth) < 1) defects.push(`missing divider after column ${column}`);
          });
        }
        for (const cell of table.querySelectorAll("[data-table-select]")) {
          const checkbox = cell.querySelector('[role="checkbox"]');
          if (!checkbox) continue;
          const a = cell.getBoundingClientRect(), b = checkbox.getBoundingClientRect();
          if (Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2) > 1) defects.push("checkbox not horizontally centered");
          if (Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) > 1) defects.push("checkbox not vertically centered");
        }
        const panel = table.parentElement;
        if (panel.scrollWidth > panel.clientWidth && getComputedStyle(panel).scrollbarWidth === "none") defects.push("overflow scrollbar hidden");
        return defects;
      }, logicalColumns);
      assert.deepEqual(defects, [], `${route} at ${viewport}px: ${defects.join(", ")}`);
      // Resize the actual column at every viewport, rather than only after
      // returning to the wide layout (which missed hidden grips previously).
      await handle.scrollIntoViewIfNeeded();
      const before = await page.locator("table th").evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
      const grip = await handle.boundingBox();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2 - 12, grip.y + grip.height / 2, { steps: 4 });
      await page.mouse.up();
      const after = await page.locator("table th").evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
      assert.ok(Math.abs(after[1] - Math.max(Number(await handle.getAttribute("aria-valuemin")), before[1] - 12)) < 2, `${route} at ${viewport}px: column edge follows the pointer`);
      before.forEach((width, column) => { if (column !== 1) assert.ok(Math.abs(after[column] - width) < 2, `neighbor ${column} moved`); });
      if (viewport === 1112) {
        for (const resize of await page.locator('table [data-slot="column-resize-handle"]').all()) {
          await resize.scrollIntoViewIfNeeded();
          const column = await resize.evaluate(element => element.closest("th").cellIndex);
          const widths = await page.locator("table th").evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
          const box = await resize.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width / 2 + 16, box.y + box.height / 2, { steps: 4 });
          await page.mouse.up();
          const changed = await page.locator("table th").evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
          assert.ok(Math.abs(changed[column] - widths[column] - 16) < 2, `column ${column} resizes in a narrow panel`);
          widths.forEach((width, index) => { if (index !== column) assert.ok(Math.abs(changed[index] - width) < 2, `neighbor ${index} moved`); });
        }
      }
      await page.getByRole("columnheader", { name: "Actions", exact: true }).scrollIntoViewIfNeeded();
      const actionsReachable = await page.locator("table th:last-child").evaluate(cell => {
        const box = cell.getBoundingClientRect(), panel = cell.closest("table").parentElement.getBoundingClientRect();
        return box.left >= panel.left - 1 && box.right <= panel.right + 1;
      });
      assert.ok(actionsReachable, "horizontal scrolling reaches the complete actions column");
      console.log(`PASS ${route} at ${viewport}px: separate columns, continuous dividers, pointer resizing and reachable actions`);
    }
    const saved = await page.locator("table th").evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
    await page.reload();
    await page.waitForFunction(() => document.querySelector("table")?.style.getPropertyValue("--table-width"));
    await settle();
    const restored = await page.locator("table th").evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
    restored.forEach((width, column) => assert.ok(Math.abs(width - saved[column]) < 2, `saved column ${column} changed`));
    await handle.press("Home");
    assert.ok(Math.abs(Number(await handle.getAttribute("aria-valuenow")) - 120) < 1);
    console.log(`PASS ${route}: saved widths and readable keyboard minimum`);
  }
  assert.deepEqual(errors, [], "browser errors");
} finally {
  await browser.close();
}
